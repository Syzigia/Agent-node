import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { spawn } from "child_process";
import * as fs from "fs";
import { AUDIO_CODEC, AUDIO_BITRATE, AUDIO_SAMPLE_RATE } from "../constants";

/**
 * Check if a video file has an audio stream
 */
export function checkAudioStream(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobeInstaller.path, [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      videoPath,
    ]);

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", () => {
      const hasAudio = output.trim().toLowerCase().includes("audio");
      resolve(hasAudio);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to check audio stream: ${err.message}`));
    });
  });
}

/**
 * Extract audio from video to MP3 using FFmpeg
 */
export function extractAudioToMp3(videoPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[extractAudioToMp3] Extracting audio to: ${outputPath}`);

    const args = [
      "-i", videoPath,
      "-vn", // No video
      "-acodec", AUDIO_CODEC,
      "-ar", String(AUDIO_SAMPLE_RATE),
      "-b:a", AUDIO_BITRATE,
      "-y", // Overwrite output
      outputPath,
    ];

    const proc = spawn(ffmpegInstaller.path, args);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

/**
 * Get duration of an audio file using ffprobe
 */
export function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobeInstaller.path, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", () => {
      const duration = parseFloat(output.trim());
      if (isNaN(duration)) {
        reject(new Error("Failed to parse audio duration"));
      } else {
        resolve(parseFloat(duration.toFixed(3)));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to get audio duration: ${err.message}`));
    });
  });
}
