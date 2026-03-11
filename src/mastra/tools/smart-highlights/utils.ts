import * as fs from "fs";
import * as path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { spawn } from "child_process";
import { TEMP_DIR, TEMP_FILE_PREFIX } from "./constants";

/**
 * Smart Highlights Clipper - Shared Utilities
 *
 * This file contains shared utility functions used across the workflow tools.
 */

// ============================================================================
// Temporary File Management
// ============================================================================

/**
 * Generate a unique temporary file path
 * @param extension - File extension (e.g., '.mp3', '.json')
 * @param identifier - Optional identifier to include in filename
 * @returns Absolute path to the temporary file
 */
export function generateTempPath(extension: string, identifier?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const idPart = identifier ? `-${identifier}` : "";
  const filename = `${TEMP_FILE_PREFIX}${timestamp}-${random}${idPart}${extension}`;

  // Ensure temp directory exists
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  return path.join(TEMP_DIR, filename);
}

/**
 * Remove multiple files, logging failures but continuing
 * @param filePaths - Array of file paths to remove
 * @returns Object with lists of successfully and failed deletions
 */
export function removeFiles(filePaths: string[]): {
  deleted: string[];
  failed: Array<{ path: string; error: string }>;
} {
  const deleted: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(filePath);
      }
    } catch (error) {
      failed.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { deleted, failed };
}

// ============================================================================
// FFmpeg Availability
// ============================================================================

/**
 * Check if FFmpeg is available and working
 */
function isFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(ffmpegInstaller.path, ["-version"]);
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Check if FFprobe is available and working
 */
function isFFprobeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(ffprobeInstaller.path, ["-version"]);
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Verify that required dependencies are available
 * @throws Error if FFmpeg or FFprobe is not available
 */
export async function verifyDependencies(): Promise<void> {
  const [ffmpegAvailable, ffprobeAvailable] = await Promise.all([
    isFFmpegAvailable(),
    isFFprobeAvailable(),
  ]);

  if (!ffmpegAvailable) {
    throw new Error(
      "FFmpeg is not available. Please install FFmpeg or ensure @ffmpeg-installer/ffmpeg is properly installed.",
    );
  }

  if (!ffprobeAvailable) {
    throw new Error(
      "FFprobe is not available. Please install FFprobe or ensure @ffprobe-installer/ffprobe is properly installed.",
    );
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Execute a function with retry logic
 * @param fn - Function to execute
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @param delayMs - Delay between attempts in milliseconds (default: 1000)
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        console.log(`[withRetry] Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}
