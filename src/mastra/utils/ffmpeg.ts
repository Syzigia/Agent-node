/**
 * Shared FFmpeg/FFprobe utilities
 *
 * Centralises media helpers that were previously duplicated across
 * silence-cutter-workflow, analyze-visual, and generate-clips.
 */

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { spawn, type ChildProcess } from "child_process";

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
