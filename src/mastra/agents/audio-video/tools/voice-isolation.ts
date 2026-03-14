import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readFile } from "fs/promises";
import Replicate from "replicate";
import { WORKSPACE_PATH, sanitizePath } from "../../../workspace";
import {
  hasVideoStream,
  extractAudio,
  mergeAudioVideo,
} from "../../../utils/ffmpeg";

/**
 * Replicate model version for resemble-enhance.
 * Handles both denoising and audio enhancement.
 */
const REPLICATE_MODEL =
  "resemble-ai/resemble-enhance:93266a7e7f5805fb79bcf213b1a4e0ef2e45aff3c06eefd96c59e850c87fd6a2" as const;

/**
 * Download the processed audio from Replicate's output URL and return it as
 * a Buffer.  The URL is temporary (valid for a few hours after the run).
 */
async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download processed audio from Replicate (HTTP ${response.status}): ${url}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Build a base64 data URI from a local file path.
 * Uses `audio/mpeg` for .mp3 and `audio/wav` for everything else.
 */
async function fileToDataURI(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".mp3" ? "audio/mpeg" : "audio/wav";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Send an audio file to Replicate's resemble-enhance model and return the
 * URL of the cleaned output.
 */
async function enhanceAudio(audioPath: string): Promise<string> {
  // The project uses REPLICATE_API_KEY; the SDK default is REPLICATE_API_TOKEN.
  // Pass the token explicitly so either variable name works.
  const auth = process.env.REPLICATE_API_KEY ?? process.env.REPLICATE_API_TOKEN;
  if (!auth) {
    throw new Error(
      "Replicate API key not found. Set REPLICATE_API_KEY in your .env file.",
    );
  }
  const replicate = new Replicate({ auth });

  console.log("[voiceIsolation] Building data URI from:", audioPath);
  const audioURI = await fileToDataURI(audioPath);

  console.log("[voiceIsolation] Sending to Replicate resemble-enhance...");
  const output = await replicate.run(REPLICATE_MODEL, {
    input: {
      input_audio: audioURI,
      solver: "Midpoint",
      denoise_flag: true,
      prior_temperature: 0.5,
      number_function_evaluations: 64,
    },
  });

  // The model returns an array of URIs: string[]
  // Take the first (and typically only) entry.
  const outputArray = output as string[];
  const url = Array.isArray(outputArray) ? outputArray[0] : undefined;

  if (!url) {
    throw new Error(
      `Unexpected output from Replicate model: ${JSON.stringify(output)}`,
    );
  }

  console.log("[voiceIsolation] Replicate output URL:", url);
  return url;
}

/**
 * Tool: Voice Isolation / Audio Enhancement via Replicate
 *
 * Cleans and enhances the audio of a file using resemble-ai/resemble-enhance
 * (noise suppression + audio enhancement) running on Replicate.
 *
 * Behaviour by input type:
 *
 *  • Audio only (mp3, wav, m4a, ogg, flac, …)
 *    The file is uploaded directly to Replicate.
 *    Output: <name>_isolated.mp3
 *
 *  • Video (mp4, mov, avi, mkv, webm, …)
 *    1. Audio is extracted from the video.
 *    2. The extracted audio is sent to Replicate.
 *    3. The cleaned audio is merged back into the original video
 *       (video stream copied losslessly, audio re-encoded to AAC).
 *    Output: <name>_isolated.<original_ext>
 *
 * Requires the REPLICATE_API_TOKEN environment variable to be set.
 */
export const voiceIsolationTool = createTool({
  id: "voice-isolation",
  description: `Cleans and enhances audio using resemble-ai/resemble-enhance on Replicate (cloud processing).

Applies noise suppression and audio enhancement to:
- Pure audio files → saved as <name>_isolated.mp3
- Video files → audio is extracted, cleaned, then merged back into the video
  (video stream is never re-encoded) → saved as <name>_isolated.<ext>

Supported audio: mp3, wav, m4a, ogg, flac
Supported video: mp4, mov, avi, mkv, webm, flv

Requires: REPLICATE_API_TOKEN environment variable.

Example: { file: "podcast.mp3" } → podcast_isolated.mp3
Example: { file: "interview.mp4" } → interview_isolated.mp4`,
  inputSchema: z.object({
    file: z
      .string()
      .describe(
        "Relative path within the workspace to the audio or video file (e.g. 'podcast.mp3', 'clips/interview.mp4')",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string().optional().describe("Relative workspace path of the output file"),
    message: z.string(),
    originalSize: z.number().optional().describe("Original file size in bytes"),
    outputSize: z.number().optional().describe("Output file size in bytes"),
    error: z.string().optional(),
  }),
  execute: async (inputData, _context: ToolExecutionContext) => {
    const file = sanitizePath(inputData.file);
    const inputPath = path.join(WORKSPACE_PATH, file);

    console.log("[voiceIsolation] Starting for:", file);

    // ── 1. Verify the file exists ────────────────────────────────────────────
    if (!fs.existsSync(inputPath)) {
      return {
        success: false,
        message: `File not found: ${file}`,
        error: "File does not exist in the workspace",
      };
    }

    const originalSize = fs.statSync(inputPath).size;
    const ext = path.extname(file).toLowerCase();
    const baseName = path.basename(file, ext);

    // ── 2. Detect whether the input contains a video stream ──────────────────
    const isVideo = await hasVideoStream(inputPath);
    console.log("[voiceIsolation] Is video:", isVideo);

    // Temp files go to the OS temp directory — never visible in the workspace.
    // The OS cleans them up on reboot; we also delete them explicitly on success/error.
    const tempDir = os.tmpdir();
    const tempAudioPath = path.join(tempDir, `${baseName}_temp_isolation_audio.mp3`);
    const tempCleanAudioPath = path.join(tempDir, `${baseName}_temp_clean_audio.mp3`);

    // Final output path
    const outputRel = isVideo
      ? `${baseName}_isolated${ext}`
      : `${baseName}_isolated.mp3`;
    const outputPath = path.join(WORKSPACE_PATH, outputRel);

    try {
      // ── 3a. Ensure the audio fed to Replicate is always an MP3 ──────────────
      //   • Video          → extract the audio track
      //   • Audio non-MP3  → convert to MP3 (m4a, wav, ogg, flac, …)
      //   • Audio MP3      → use directly, no temp file needed
      let audioSourcePath: string;

      if (isVideo) {
        console.log("[voiceIsolation] Extracting audio from video...");
        await extractAudio(inputPath, tempAudioPath);
        audioSourcePath = tempAudioPath;
      } else if (ext !== ".mp3") {
        console.log(`[voiceIsolation] Converting ${ext} → MP3 before upload...`);
        await extractAudio(inputPath, tempAudioPath);
        audioSourcePath = tempAudioPath;
      } else {
        audioSourcePath = inputPath;
      }
      const cleanAudioUrl = await enhanceAudio(audioSourcePath);

      // ── 4. Download the processed audio ───────────────────────────────────
      console.log("[voiceIsolation] Downloading cleaned audio...");
      const cleanAudioBuffer = await downloadAudio(cleanAudioUrl);

      if (isVideo) {
        // ── 5a. Video: save temp clean audio, then merge back into video ─────
        fs.writeFileSync(tempCleanAudioPath, cleanAudioBuffer);

        console.log("[voiceIsolation] Merging clean audio back into video...");
        await mergeAudioVideo(inputPath, tempCleanAudioPath, outputPath);

        // Clean up both temp audio files
        for (const p of [tempAudioPath, tempCleanAudioPath]) {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      } else {
        // ── 5b. Audio only: write the MP3 buffer directly ────────────────────
        fs.writeFileSync(outputPath, cleanAudioBuffer);

        // Clean up temp conversion file if one was created (non-MP3 input)
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      }

      const outputSize = fs.statSync(outputPath).size;
      console.log("[voiceIsolation] Done. Output:", outputRel, `(${outputSize} bytes)`);

      return {
        success: true,
        output: outputRel,
        message: `Audio enhanced successfully. Output saved as: ${outputRel}`,
        originalSize,
        outputSize,
      };
    } catch (err: any) {
      console.error("[voiceIsolation] ERROR:", err.message);

      // Best-effort cleanup of any temp files (all in os.tmpdir())
      for (const p of [tempAudioPath, tempCleanAudioPath]) {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
      }

      // Also remove the partial output from the workspace if it was created
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      }

      return {
        success: false,
        message: `Voice isolation failed: ${err.message}`,
        error: err.message,
        originalSize,
      };
    }
  },
});
