import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import { type VisualScene } from "../types";
import {
  DEFAULT_SCENE_THRESHOLD,
  UNIFORM_SAMPLE_FRAMES,
} from "../constants";
import { withRetry } from "../utils";
import { getMediaDuration } from "../../../utils/ffmpeg";

// Re-export for backwards compatibility (used by smart-highlights-clipper workflow)
export { getMediaDuration as getVideoDuration } from "../../../utils/ffmpeg";

/**
 * Detect scenes using FFmpeg scene detection filter with fallback
 */
export async function detectScenesWithFallback(
  videoPath: string,
  threshold: number,
  duration: number
): Promise<VisualScene[]> {
  return withRetry(async () => {
    const scenes: VisualScene[] = [];
    const sceneChanges: number[] = [0];

    // Use FFmpeg scene detection
    const filterExpr = `select=gt(scene,${threshold}),showinfo`;
    const proc = spawn(ffmpegInstaller.path, [
      "-i", videoPath,
      "-vf", filterExpr,
      "-f", "null",
      "-",
    ]);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      proc.on("close", (code) => {
        // FFmpeg often returns non-zero for filter outputs, which is OK
        resolve();
      });
      proc.on("error", reject);
    });

    // Parse scene change timestamps from stderr
    const ptsMatches = [...stderr.matchAll(/pts_time:([\d.]+)/g)];

    for (const match of ptsMatches) {
      const time = parseFloat(match[1] || "0");
      if (!isNaN(time) && time > 0) {
        sceneChanges.push(time);
      }
    }

    // Add end time
    sceneChanges.push(duration);

    // Sort and deduplicate
    const uniqueScenes = [...new Set(sceneChanges)].sort((a, b) => a - b);

    // Create scenes from scene changes
    for (let i = 0; i < uniqueScenes.length - 1; i++) {
      const start = uniqueScenes[i]!;
      const end = uniqueScenes[i + 1]!;

      if (end > start) {
        const sceneDuration = end - start;
        const midPoint = duration / 2;
        const distanceFromCenter = Math.abs((start + end) / 2 - midPoint) / midPoint;

        // Significance: shorter scenes + closer to center = higher significance
        const durationScore = Math.max(0, 1 - (sceneDuration / (duration * 0.1)));
        const positionScore = 1 - distanceFromCenter;
        const significance = parseFloat(((durationScore * 0.3 + positionScore * 0.7)).toFixed(3));

        scenes.push({
          start: parseFloat(start.toFixed(3)),
          end: parseFloat(end.toFixed(3)),
          significance: Math.min(1, Math.max(0, significance)),
        });
      }
    }

    return scenes;
  }, 3, 1000);
}

/**
 * Fallback: Create uniform frame sampling scenes
 */
export function createUniformScenes(duration: number): VisualScene[] {
  console.log(`[createUniformScenes] Creating ${UNIFORM_SAMPLE_FRAMES} uniform samples`);

  const scenes: VisualScene[] = [];
  const segmentDuration = duration / UNIFORM_SAMPLE_FRAMES;

  for (let i = 0; i < UNIFORM_SAMPLE_FRAMES; i++) {
    const start = i * segmentDuration;
    const end = Math.min((i + 1) * segmentDuration, duration);

    // Calculate significance - middle segments get higher scores
    const midPoint = duration / 2;
    const segmentMid = (start + end) / 2;
    const distanceFromCenter = Math.abs(segmentMid - midPoint) / midPoint;
    const significance = parseFloat((1 - distanceFromCenter * 0.5).toFixed(3));

    scenes.push({
      start: parseFloat(start.toFixed(3)),
      end: parseFloat(end.toFixed(3)),
      significance: Math.min(1, Math.max(0.5, significance)),
    });
  }

  return scenes;
}
