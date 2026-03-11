import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import * as fs from "fs";
import {
  CLIP_VIDEO_CODEC,
  CLIP_VIDEO_PRESET,
  CLIP_VIDEO_CRF,
  CLIP_AUDIO_CODEC,
  CLIP_AUDIO_BITRATE,
  MIN_CLIP_FILE_SIZE,
} from "../constants";

/**
 * Generate a single clip using FFmpeg with frame-accurate seeking and re-encoding.
 *
 * Uses `-ss` after `-i` (input-level decode) so FFmpeg decodes from the nearest
 * keyframe and starts the output at the exact requested timestamp. The clip is
 * re-encoded with libx264/aac to guarantee clean cuts at arbitrary positions —
 * stream copy (`-c copy`) can only cut on keyframe boundaries and produces
 * empty or corrupt files for clips shorter than the keyframe interval.
 *
 * After generation the output file size is validated against MIN_CLIP_FILE_SIZE
 * to catch silently corrupt outputs.
 */
export function generateSingleClip(
  inputPath: string,
  outputPath: string,
  start: number,
  end: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const duration = end - start;

    if (duration <= 0) {
      return reject(new Error(`Invalid clip duration: ${duration.toFixed(2)}s (start=${start}, end=${end})`));
    }

    console.log(`[generateClip] Extracting ${duration.toFixed(2)}s from ${start.toFixed(2)}s to ${end.toFixed(2)}s`);

    const args = [
      // Input file first — then seek (decode-level, frame-accurate)
      "-i", inputPath,
      "-ss", String(start),
      "-t", String(duration),
      // Re-encode video for frame-accurate cuts
      "-c:v", CLIP_VIDEO_CODEC,
      "-preset", CLIP_VIDEO_PRESET,
      "-crf", CLIP_VIDEO_CRF,
      // Re-encode audio
      "-c:a", CLIP_AUDIO_CODEC,
      "-b:a", CLIP_AUDIO_BITRATE,
      // Avoid negative timestamp issues on certain containers
      "-avoid_negative_ts", "make_zero",
      "-y",
      outputPath,
    ];

    const proc = spawn(ffmpegInstaller.path, args);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`FFmpeg failed with code ${code}: ${stderr.slice(-500)}`));
      }

      // Validate the output file is not empty / corrupt
      try {
        const stat = fs.statSync(outputPath);
        if (stat.size < MIN_CLIP_FILE_SIZE) {
          // Remove the corrupt file
          try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
          return reject(
            new Error(
              `Generated clip is too small (${stat.size} bytes, minimum ${MIN_CLIP_FILE_SIZE}). ` +
              `The source video may not contain decodable frames in the range ${start.toFixed(2)}-${end.toFixed(2)}s.`
            )
          );
        }
      } catch (statErr: any) {
        return reject(new Error(`Failed to verify output file: ${statErr.message}`));
      }

      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}
