/**
 * Shared FFmpeg/FFprobe utilities
 *
 * Centralises media helpers that were previously duplicated across
 * silence-cutter-workflow, analyze-visual, and generate-clips.
 */

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { rejects } from "assert";
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "dns";
import * as fs from "fs";
import * as path from "path";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default timeout for ffmpeg/ffprobe spawns (5 minutes). */
export const SPAWN_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum number of bytes to accumulate from stderr before truncating. */
export const MAX_STDERR_BYTES = 64 * 1024; // 64 KB

// ─── spawnWithTimeout ────────────────────────────────────────────────────────

/**
 * Spawn a child process and automatically kill it if it exceeds `timeoutMs`.
 * Returns the ChildProcess so callers can attach stdout/stderr listeners.
 */
export function spawnWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number = SPAWN_TIMEOUT_MS,
): { proc: ChildProcess; timeout: NodeJS.Timeout } {
  const proc = spawn(command, args);

  const timeout = setTimeout(() => {
    console.error(
      `[spawnWithTimeout] Process exceeded ${timeoutMs}ms timeout, killing: ${command} ${args.slice(0, 3).join(" ")}...`,
    );
    proc.kill("SIGKILL");
  }, timeoutMs);

  // Clear timeout automatically when the process exits
  proc.on("close", () => clearTimeout(timeout));
  proc.on("error", () => clearTimeout(timeout));

  return { proc, timeout };
}

/**
 * Helper to accumulate stderr up to MAX_STDERR_BYTES.
 * Once the cap is reached, further data is silently dropped.
 */
export function cappedStderr(proc: ChildProcess): { get: () => string } {
  let buf = "";
  let capped = false;

  proc.stderr?.on("data", (d: Buffer) => {
    if (capped) return;
    const chunk = d.toString();
    if (buf.length + chunk.length > MAX_STDERR_BYTES) {
      buf += chunk.slice(0, MAX_STDERR_BYTES - buf.length);
      capped = true;
    } else {
      buf += chunk;
    }
  });

  return { get: () => buf };
}

// ─── getMediaDuration ────────────────────────────────────────────────────────

/**
 * Get the duration of a media file (audio or video) via ffprobe.
 * Replaces the duplicate `getFileDuration` / `getVideoDuration` helpers.
 */
export function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobeInstaller.path, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code} for: ${filePath}`));
        return;
      }
      const dur = parseFloat(out.trim());
      if (isNaN(dur)) {
        reject(new Error(`Failed to parse media duration for: ${filePath}`));
      } else {
        resolve(parseFloat(dur.toFixed(3)));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to get media duration: ${err.message}`));
    });
  });
}

// ─── hasVideoStream ──────────────────────────────────────────────────────────

/**
 * Check whether a media file contains a video stream.
 */
export function hasVideoStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(ffprobeInstaller.path, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      filePath,
    ]);

    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });

    proc.on("close", () => resolve(out.trim().toLowerCase().includes("video")));
    proc.on("error", () => resolve(false));
  });
}

// ─── getVideoDimensions ───────────────────────────────────────────────────────

/**
 * Get video dimensions (width/height) from the first video stream.
 */
export function getVideoDimensions(filePath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobeInstaller.path, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x",
      filePath,
    ]);

    let out = "";
    let err = "";

    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe getVideoDimensions exited with code ${code}: ${err.slice(-500)}`));
        return;
      }

      const match = out.trim().match(/^(\d+)x(\d+)$/);
      if (!match) {
        reject(new Error(`Could not parse video dimensions from ffprobe output: "${out.trim()}"`));
        return;
      }

      const width = Number(match[1]);
      const height = Number(match[2]);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        reject(new Error(`Invalid video dimensions parsed: ${width}x${height}`));
        return;
      }

      resolve({ width, height });
    });

    proc.on("error", (procErr) => {
      reject(new Error(`ffprobe process error (getVideoDimensions): ${procErr.message}`));
    });
  });
}

// ─── extractAudio ────────────────────────────────────────────────────────────

/**
 * Extract the audio track from a media file and save it as MP3.
 *
 * Uses `-vn` to drop the video stream and encodes audio with libmp3lame at
 * variable-bitrate quality 2 (~190 kbps).  The output path must already have
 * an `.mp3` extension — the caller is responsible for naming it.
 *
 * Rejects if ffmpeg exits with a non-zero code.
 */
export function extractAudio(
  inputPath: string,
  outputAudioPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
      "-i", inputPath,
      "-vn",                  // drop all video streams
      "-acodec", "libmp3lame",
      "-q:a", "2",            // VBR quality 2 ≈ 190 kbps
      "-y",                   // overwrite output without prompting
      outputAudioPath,
    ]);

    const stderr = cappedStderr(proc);

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg extractAudio failed (code ${code}): ${stderr.get().slice(-500)}`));
    });

    proc.on("error", (err) => reject(new Error(`ffmpeg process error: ${err.message}`)));
  });
}

// ─── stripAudio ──────────────────────────────────────────────────────────────

/**
 * Remove all audio streams from a media file while keeping the video intact.
 *
 * Uses `-an` to drop audio and `-vcodec copy` to avoid re-encoding the video,
 * making the operation fast and lossless.  The output extension should match
 * the input container (e.g., mp4 → mp4) so the muxer stays compatible.
 *
 * Rejects if ffmpeg exits with a non-zero code.
 */
export function stripAudio(
  inputPath: string,
  outputVideoPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
      "-i", inputPath,
      "-an",           // drop all audio streams
      "-vcodec", "copy",  // copy video bitstream without re-encoding
      "-y",
      outputVideoPath,
    ]);

    const stderr = cappedStderr(proc);

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg stripAudio failed (code ${code}): ${stderr.get().slice(-500)}`));
    });

    proc.on("error", (err) => reject(new Error(`ffmpeg process error: ${err.message}`)));
  });
}

// ─── mergeAudioVideo ─────────────────────────────────────────────────────────

/**
 * Merge a new audio track into an existing video file.
 *
 * - The video stream is copied bitstream-losslessly (no re-encoding).
 * - The audio is re-encoded to AAC for maximum container compatibility
 *   (MP4, MOV, MKV all accept AAC without issues).
 * - `-shortest` ensures the output duration is capped to the shorter of the
 *   two streams, preventing silent tail if audio is slightly longer than video.
 * - The original audio track in the video is discarded (`-map 0:v:0`).
 *
 * Rejects if ffmpeg exits with a non-zero code.
 */
export function mergeAudioVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",    // copy video bitstream without re-encoding
      "-c:a", "aac",     // re-encode audio to AAC for container compatibility
      "-map", "0:v:0",   // take video stream from first input
      "-map", "1:a:0",   // take audio stream from second input
      "-shortest",       // cap duration to the shorter stream
      "-y",
      outputPath,
    ]);

    const stderr = cappedStderr(proc);

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg mergeAudioVideo failed (code ${code}): ${stderr.get().slice(-500)}`));
    });

    proc.on("error", (err) => reject(new Error(`ffmpeg process error: ${err.message}`)));
  });
}

// ─── detectSilences ──────────────────────────────────────────────────────────

export interface SilenceSegment {
  start: number;
  end: number;
  duration: number;
}

/**
 * Detect silence segments in a media file using FFmpeg's silencedetect filter.
 *
 * Fixes vs. the original implementation:
 * - M4: Rejects when FFmpeg exits with a non-zero code.
 * - H6: Uses `fileDuration` as the end time for a trailing silence_start
 *        that has no matching silence_end.
 */
export function detectSilences(
  inputPath: string,
  noiseDb: number,
  minDuration: number,
  fileDuration: number,
): Promise<SilenceSegment[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, [
      "-i", inputPath,
      "-af", `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
      "-f", "null", "-",
    ]);

    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      // M4: check ffmpeg exit code
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg silencedetect exited with code ${code}: ${stderr.slice(-500)}`,
          ),
        );
        return;
      }

      const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)];
      const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)];
      const segments: SilenceSegment[] = [];

      for (let i = 0; i < starts.length; i++) {
        const startMatch = starts[i];
        if (!startMatch?.[1]) continue;

        const start = parseFloat(startMatch[1]);
        // H6: if no matching silence_end, use fileDuration as fallback
        const end = ends[i]?.[1] ? parseFloat(ends[i]![1]!) : fileDuration;

        if (end > start) {
          segments.push({
            start: parseFloat(start.toFixed(3)),
            end: parseFloat(end.toFixed(3)),
            duration: parseFloat((end - start).toFixed(3)),
          });
        }
      }

      resolve(segments);
    });

    proc.on("error", reject);
  });
}


export function splitAudio(inputPath: string, outputDir: string, segmentTimeSeconds: number = 600): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPattern = path.join(outputDir, `${baseName}_chunk_%03d.mp3`);

    const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
      "-i", inputPath,
      "-f", "segment",
      "-segment_time", segmentTimeSeconds.toString(),
      "-c", "copy",
      outputPattern
    ]);

    const stderr = cappedStderr(proc);

    proc.on("close", (code) => {
      if (code === 0) {
        const files = fs.readdirSync(outputDir)
          .filter(f => f.startsWith(`${baseName}_chunk_`) && f.endsWith('.mp3'))
          .map(f => path.join(outputDir, f))
          .sort();
        resolve(files);
      } else {
        reject(new Error(`ffmpeg splitAudio failed (code ${code}): ${stderr.get().slice(-500)}`));
      }
    });

    proc.on("error", (err) => reject(new Error(`ffmpeg process error: ${err.message}`)));
  })
}
