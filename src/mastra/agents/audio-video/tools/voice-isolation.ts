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
  extractAudio,
  mergeAudioVideo,
} from "../../../utils/ffmpeg";

/**
 * Extensions that are treated as video containers.
 * Audio-only formats (including .mp3 and .m4a, which may carry embedded cover
 * art that would fool hasVideoStream()) are intentionally excluded so they
 * always go through the audio-only code path.
 */
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".ts",
]);

/**
 * Replicate model version for resemble-enhance.
 * Handles both denoising and audio enhancement.
 */
const REPLICATE_MODEL =
  "resemble-ai/resemble-enhance:93266a7e7f5805fb79bcf213b1a4e0ef2e45aff3c06eefd96c59e850c87fd6a2" as const;

/**
 * Download the processed audio from a URL and return it as a Buffer.
 * Used as a fallback when Replicate returns a plain URL string.
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
 * Read all chunks from a WHATWG ReadableStream<Uint8Array> into a Buffer.
 */
async function readStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return Buffer.from(result);
}

/**
 * Build a base64 data URI from a local file path.
 * Uses `audio/mpeg` for .mp3 and `audio/wav` for everything else.
 * By the time this is called the file is always an .mp3 temp file.
 */
async function fileToDataURI(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".mp3" ? "audio/mpeg" : "audio/wav";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Send an audio file to Replicate's resemble-enhance model and return the
 * cleaned audio as a Buffer.
 *
 * The Replicate SDK may return either:
 *  - A plain URL string (older SDK / some model versions)
 *  - A FileOutput object that implements ReadableStream<Uint8Array>
 * Both cases are handled here so the caller always receives a Buffer.
 */
async function enhanceAudio(audioPath: string): Promise<Buffer> {
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

  // The model returns an array — grab the first element.
  const outputArray = output as unknown[];
  const firstOutput = Array.isArray(outputArray) ? outputArray[0] : undefined;

  if (!firstOutput) {
    throw new Error(
      `Unexpected output from Replicate model: ${JSON.stringify(output)}`,
    );
  }

  // Case 1: FileOutput / ReadableStream returned by the current Replicate SDK
  if (
    typeof firstOutput === "object" &&
    firstOutput !== null &&
    typeof (firstOutput as any).getReader === "function"
  ) {
    console.log("[voiceIsolation] Replicate returned a ReadableStream — reading directly...");
    return readStreamToBuffer(firstOutput as ReadableStream<Uint8Array>);
  }

  // Case 2: Plain URL string (fallback for older SDK versions)
  if (typeof firstOutput === "string") {
    console.log("[voiceIsolation] Replicate output URL:", firstOutput);
    return downloadAudio(firstOutput);
  }

  throw new Error(
    `Unrecognised output type from Replicate model: ${typeof firstOutput} — ${JSON.stringify(firstOutput)}`,
  );
}

/**
 * Process a single file: convert/extract to MP3 if needed, send to Replicate,
 * download the result, and write the final output.
 *
 * Temp files are written to os.tmpdir() and always cleaned up on
 * success or failure so the workspace stays untouched.
 *
 * @param file    Sanitized relative path within the workspace.
 * @param index   Position in the batch — used to avoid temp-file name
 *                collisions when two files share the same basename.
 */
async function processFile(
  file: string,
  index: number,
): Promise<{ output: string; originalSize: number; outputSize: number }> {
  const inputPath = path.join(WORKSPACE_PATH, file);
  const originalSize = fs.statSync(inputPath).size;
  const ext = path.extname(file).toLowerCase();
  const baseName = path.basename(file, ext);

  // Unique prefix per file prevents collisions between files sharing a baseName
  const tempPrefix = `${baseName}_${index}`;
  const tempDir = os.tmpdir();
  const tempAudioPath = path.join(tempDir, `${tempPrefix}_isolation_audio.mp3`);
  const tempCleanAudioPath = path.join(tempDir, `${tempPrefix}_clean_audio.mp3`);

  const isVideo = VIDEO_EXTENSIONS.has(ext);
  console.log(`[voiceIsolation] [${index + 1}] ${file} — isVideo: ${isVideo}`);

  const outputRel = isVideo
    ? `${baseName}_isolated${ext}`
    : `${baseName}_isolated.mp3`;
  const outputPath = path.join(WORKSPACE_PATH, outputRel);

  try {
    // ── 1. Ensure Replicate always receives an MP3 ───────────────────────────
    //   • Video          → extract audio track to temp MP3
    //   • Any audio file → always convert to temp MP3
    //     (handles malformed codecs, embedded cover art in mp3/m4a, etc.)
    let audioSourcePath: string;

    if (isVideo) {
      console.log(`[voiceIsolation] [${index + 1}] Extracting audio from video...`);
      await extractAudio(inputPath, tempAudioPath);
      audioSourcePath = tempAudioPath;
    } else {
      console.log(`[voiceIsolation] [${index + 1}] Converting audio → MP3...`);
      await extractAudio(inputPath, tempAudioPath);
      audioSourcePath = tempAudioPath;
    }

    // ── 2. Enhance via Replicate ─────────────────────────────────────────────
    console.log(`[voiceIsolation] [${index + 1}] Sending to Replicate...`);
    const cleanAudioBuffer = await enhanceAudio(audioSourcePath);

    // ── 3. Write final output ────────────────────────────────────────────────
    if (isVideo) {
      console.log(`[voiceIsolation] [${index + 1}] Merging clean audio back into video...`);
      fs.writeFileSync(tempCleanAudioPath, cleanAudioBuffer);
      await mergeAudioVideo(inputPath, tempCleanAudioPath, outputPath);
    } else {
      fs.writeFileSync(outputPath, cleanAudioBuffer);
    }

    const outputSize = fs.statSync(outputPath).size;
    console.log(`[voiceIsolation] [${index + 1}] Done → ${outputRel} (${outputSize} bytes)`);

    return { output: outputRel, originalSize, outputSize };

  } finally {
    // Always clean up temp files regardless of success or failure
    for (const p of [tempAudioPath, tempCleanAudioPath]) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
  }
}

/**
 * Tool: Voice Isolation / Audio Enhancement via Replicate
 *
 * Accepts one or more audio/video files and cleans their audio using
 * resemble-ai/resemble-enhance (noise suppression + audio enhancement)
 * running on Replicate.
 *
 * Files are processed sequentially. Failures on individual files do not
 * stop the rest of the batch.
 *
 * Behaviour by input type:
 *  • Audio only (mp3, wav, m4a, ogg, flac, …)  → <name>_isolated.mp3
 *  • Video (mp4, mov, avi, mkv, webm, …)
 *      audio extracted → cleaned → merged back (video stream never re-encoded)
 *      → <name>_isolated.<original_ext>
 *
 * Requires the REPLICATE_API_KEY environment variable to be set.
 */
export const voiceIsolationTool = createTool({
  id: "voice-isolation",
  description: `Cleans and enhances audio using resemble-ai/resemble-enhance on Replicate (cloud processing).

Accepts one or more audio or video files. Files are processed sequentially;
a failure on one file does not stop the rest of the batch.

Per-file behaviour:
- Pure audio (mp3, wav, m4a, ogg, flac) → <name>_isolated.mp3
- Video (mp4, mov, avi, mkv, webm, flv) → audio extracted, cleaned, merged back
  (video stream copied losslessly) → <name>_isolated.<ext>

Requires: REPLICATE_API_KEY environment variable.

Examples:
  { files: ["podcast.mp3"] }
  { files: ["interview.mp4", "voiceover.m4a", "recording.wav"] }`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .min(1)
      .describe(
        "Array of relative paths within the workspace to the audio or video files to enhance (e.g. ['podcast.mp3', 'clips/interview.mp4'])",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("True if at least one file was processed successfully"),
    processed: z.number().describe("Number of files successfully enhanced"),
    failed: z.number().describe("Number of files that failed"),
    results: z.array(
      z.object({
        file: z.string().describe("Input file path"),
        output: z.string().describe("Output file path in the workspace"),
        originalSize: z.number().describe("Input file size in bytes"),
        outputSize: z.number().describe("Output file size in bytes"),
      }),
    ),
    errors: z.array(
      z.object({
        file: z.string().describe("Input file path that failed"),
        error: z.string().describe("Error message"),
      }),
    ),
  }),
  execute: async (inputData, _context: ToolExecutionContext) => {
    const results: Array<{
      file: string;
      output: string;
      originalSize: number;
      outputSize: number;
    }> = [];
    const errors: Array<{ file: string; error: string }> = [];

    console.log(`[voiceIsolation] Starting batch of ${inputData.files.length} file(s)...`);

    for (let i = 0; i < inputData.files.length; i++) {
      const rawFile = inputData.files[i]!;
      let file: string;

      // ── Sanitize path ──────────────────────────────────────────────────────
      try {
        file = sanitizePath(rawFile);
      } catch (err: any) {
        errors.push({ file: rawFile, error: err.message });
        continue;
      }

      // ── Verify file exists ─────────────────────────────────────────────────
      const inputPath = path.join(WORKSPACE_PATH, file);
      if (!fs.existsSync(inputPath)) {
        errors.push({ file, error: "File not found in workspace" });
        continue;
      }

      // ── Process ────────────────────────────────────────────────────────────
      try {
        const result = await processFile(file, i);
        results.push({ file, ...result });
      } catch (err: any) {
        console.error(`[voiceIsolation] [${i + 1}] FAILED: ${file} —`, err.message);
        errors.push({ file, error: err.message });
      }
    }

    console.log(
      `[voiceIsolation] Batch complete — ${results.length} succeeded, ${errors.length} failed.`,
    );

    return {
      success: results.length > 0,
      processed: results.length,
      failed: errors.length,
      results,
      errors,
    };
  },
});
