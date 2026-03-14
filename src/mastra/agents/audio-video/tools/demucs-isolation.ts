import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { WORKSPACE_PATH, sanitizePath } from "../../../workspace";
import { LocalVoiceIsolator } from "./local-voice-isolator";

/**
 * Extracts audio from a video file using ffmpeg.
 * Returns the path to the temporary audio file.
 */
function extractAudioFromVideo(
  videoPath: string,
  outputAudioPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("[demucsIsolation] Extracting audio from video...");
    
    const proc = spawn(ffmpegInstaller.path, [
      "-i", videoPath,
      "-vn",                    // No video
      "-acodec", "libmp3lame", // MP3 codec
      "-q:a", "2",             // High quality
      "-y",                    // Overwrite if exists
      outputAudioPath,
    ]);
    
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    
    proc.on("close", (code) => {
      if (code === 0) {
        console.log("[demucsIsolation] Audio extracted successfully");
        resolve();
      } else {
        reject(new Error(`ffmpeg error (code ${code}): ${stderr.slice(-500)}`));
      }
    });
    
    proc.on("error", reject);
  });
}

/**
 * Converts any audio file to MP3 using ffmpeg.
 * Ensures maximum compatibility with local processing.
 */
function convertToMp3(
  inputPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("[demucsIsolation] Converting audio to MP3...");
    console.log("[demucsIsolation] Input:", inputPath);
    console.log("[demucsIsolation] Output:", outputPath);
    
    const proc = spawn(ffmpegInstaller.path, [
      "-i", inputPath,
      "-acodec", "libmp3lame", // MP3 codec
      "-q:a", "2",             // High quality
      "-y",                    // Overwrite if exists
      outputPath,
    ]);
    
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    
    proc.on("close", (code) => {
      if (code === 0) {
        console.log("[demucsIsolation] MP3 conversion successful");
        resolve();
      } else {
        reject(new Error(`ffmpeg conversion error (code ${code}): ${stderr.slice(-500)}`));
      }
    });
    
    proc.on("error", reject);
  });
}

/**
 * Tool: Voice Isolation with Demucs ONNX (Local Processing)
 * Isolates vocals from an audio or video file using Demucs v4 ONNX locally.
 * 
 * This tool uses local processing with ONNX Runtime — no cloud services required.
 * The Demucs model is downloaded automatically on first run (303 MB).
 * 
 * Features:
 * - 100% local processing, no internet dependency after download
 * - State-of-the-art separation quality (Demucs v4)
 * - No recurring costs or quota limits
 * - Requires ~600 MB of RAM during processing
 * - Processing time: 1-5x the audio duration (depends on hardware)
 */
export const demucsIsolationTool = createTool({
  id: "voice-isolation",
  description: `Isolates vocals from an audio or video file using Demucs ONNX locally.

Supported formats:
- Audio: mp3, wav, m4a, ogg, flac
- Video: mp4, mov, avi, mkv, webm, flv (automatically extracts audio)

Uses Demucs v4 (Hybrid Transformer) for high-quality local separation.
The output file contains only vocals in MP3 format.
The file is saved with the "_isolated" suffix.

Features:
- 100% local processing (no API keys or cloud services needed)
- Automatic model download (303 MB, first run only)
- No usage limits or recurring costs
- Professional-grade separation quality

Requirements:
- ~600 MB of available RAM
- 303 MB of disk space for the model
- Processing time: 1-5x the audio duration

Example: { file: "wild_project.mp4" } -> generates wild_project_isolated.mp3`,
  inputSchema: z.object({
    file: z.string().describe("Relative path within the workspace to the audio or video file"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string().optional().describe("Name of the generated file"),
    message: z.string(),
    originalSize: z.number().optional().describe("Original size in bytes"),
    outputSize: z.number().optional().describe("Output size in bytes"),
    error: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    const file = sanitizePath(inputData.file);
    const inputPath = path.join(WORKSPACE_PATH, file);
    
    console.log("[demucsIsolation] Starting local processing...");
    console.log("[demucsIsolation] File:", file);
    
    // Verify file exists
    if (!fs.existsSync(inputPath)) {
      console.error("[demucsIsolation] ERROR: File not found:", file);
      return {
        success: false,
        message: `File not found: ${file}`,
        error: "File does not exist in the workspace",
      };
    }
    
    const originalSize = fs.statSync(inputPath).size;
    console.log("[demucsIsolation] Original size:", originalSize, "bytes");
    
    // Determine if it's video or audio
    const ext = path.extname(file).toLowerCase();
    const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv"];
    const isVideo = videoExtensions.includes(ext);
    
    let audioPath: string;
    let tempAudioPath: string | null = null;
    let tempConvertedPath: string | null = null;
    
    try {
      // Step 1: Extract audio if video, or convert to MP3 if audio
      const baseName = path.basename(file, ext);
      
      if (isVideo) {
        // Extract audio from video
        tempAudioPath = path.join(WORKSPACE_PATH, `${baseName}_temp_audio.mp3`);
        await extractAudioFromVideo(inputPath, tempAudioPath);
        audioPath = tempAudioPath;
      } else if (ext === ".mp3") {
        // Already MP3, use directly
        audioPath = inputPath;
      } else {
        // Convert any other format to MP3
        tempConvertedPath = path.join(WORKSPACE_PATH, `${baseName}_converted.mp3`);
        await convertToMp3(inputPath, tempConvertedPath);
        audioPath = tempConvertedPath;
      }
      
      console.log("[demucsIsolation] Audio prepared:", audioPath);
      
      // Step 2: Process with local Demucs ONNX
      console.log("[demucsIsolation] Starting local voice isolation...");
      console.log("[demucsIsolation] Note: First run will download the model (303 MB)");
      
      const isolator = new LocalVoiceIsolator();
      const vocalsBuffer = await isolator.isolateVocals(audioPath);
      
      // Step 3: Save result
      const outputRel = `${baseName}_isolated.mp3`;
      const outputPath = path.join(WORKSPACE_PATH, outputRel);
      
      fs.writeFileSync(outputPath, vocalsBuffer);
      
      const outputSize = vocalsBuffer.length;
      console.log("[demucsIsolation] File saved:", outputRel);
      console.log("[demucsIsolation] Output size:", outputSize, "bytes");
      
      // Step 4: Cleanup
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
        console.log("[demucsIsolation] Temporary video audio file removed");
      }
      
      if (tempConvertedPath && fs.existsSync(tempConvertedPath)) {
        fs.unlinkSync(tempConvertedPath);
        console.log("[demucsIsolation] Temporary converted file removed");
      }
      
      return {
        success: true,
        output: outputRel,
        message: `Voice isolated successfully with local Demucs ONNX. File saved: ${outputRel}`,
        originalSize,
        outputSize,
      };
      
    } catch (error: any) {
      console.error("[demucsIsolation] ERROR:", error.message);
      
      // Cleanup on error
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
      }
      
      if (tempConvertedPath && fs.existsSync(tempConvertedPath)) {
        fs.unlinkSync(tempConvertedPath);
      }
      
      return {
        success: false,
        message: `Processing error: ${error.message}`,
        error: error.message,
      };
    }
  },
});
