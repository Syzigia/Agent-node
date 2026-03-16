import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import * as fs from "fs";
import * as path from "path";

import { cappedStderr, getMediaDuration, spawnWithTimeout } from "../../utils/ffmpeg";
import {
  COPY_SAFE_TOLERANCE_SECONDS,
  DEFAULT_FRAME_INTERVAL_SECONDS,
  DEFAULT_SCENE_THRESHOLD,
} from "./constants";
import type { ProposedClip, SampledFrame, SceneBoundary } from "./types";

export interface MediaMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

function parseFraction(raw: string | undefined): number {
  if (!raw) return 0;
  if (!raw.includes("/")) return Number(raw) || 0;
  const [num, den] = raw.split("/");
  const numerator = Number(num);
  const denominator = Number(den);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

export async function checkAudioStream(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffprobeInstaller.path, [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      videoPath,
    ]);
    let output = "";

    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", () => {
      resolve(output.trim().toLowerCase().includes("audio"));
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to check audio stream: ${error.message}`));
    });
  });
}

export async function readMediaMetadata(videoPath: string): Promise<MediaMetadata> {
  const duration = await getMediaDuration(videoPath);

  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffprobeInstaller.path, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      videoPath,
    ]);
    const stderr = cappedStderr(proc);
    let stdout = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe metadata failed (code ${code}): ${stderr.get().slice(-500)}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          streams?: Array<Record<string, unknown>>;
        };
        const streams = parsed.streams ?? [];
        const videoStream = streams.find((stream) => stream.codec_type === "video");
        const audioStream = streams.find((stream) => stream.codec_type === "audio");

        if (!videoStream) {
          throw new Error("No video stream found");
        }

        resolve({
          duration,
          width: Number(videoStream.width ?? 0),
          height: Number(videoStream.height ?? 0),
          fps: parseFraction(String(videoStream.avg_frame_rate ?? videoStream.r_frame_rate ?? "0")),
          hasAudio: Boolean(audioStream),
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    proc.on("error", (error) => {
      reject(new Error(`ffprobe process error: ${error.message}`));
    });
  });
}

export async function prepareAudioArtifact(videoPath: string, audioPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
      "-i",
      videoPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      "-y",
      audioPath,
    ]);
    const stderr = cappedStderr(proc);

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg audio extraction failed (code ${code}): ${stderr.get().slice(-500)}`));
    });

    proc.on("error", (error) => {
      reject(new Error(`ffmpeg process error: ${error.message}`));
    });
  });
}

function buildFallbackScenes(duration: number): SceneBoundary[] {
  const sceneCount = 100;
  const segmentDuration = duration / sceneCount;
  const scenes: SceneBoundary[] = [];

  for (let i = 0; i < sceneCount; i++) {
    const start = i * segmentDuration;
    const end = Math.min((i + 1) * segmentDuration, duration);
    scenes.push({
      start: parseFloat(start.toFixed(3)),
      end: parseFloat(end.toFixed(3)),
      significance: 0.5,
    });
  }

  return scenes;
}

export async function detectSceneBoundaries(videoPath: string, duration: number): Promise<SceneBoundary[]> {
  try {
    return await new Promise((resolve, reject) => {
      const scenes: SceneBoundary[] = [];
      const sceneChanges: number[] = [0];
      const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
        "-i",
        videoPath,
        "-vf",
        `select=gt(scene,${DEFAULT_SCENE_THRESHOLD}),showinfo`,
        "-f",
        "null",
        "-",
      ]);
      let stderr = "";

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", () => {
        const ptsMatches = [...stderr.matchAll(/pts_time:([\d.]+)/g)];

        for (const match of ptsMatches) {
          const time = parseFloat(match[1] || "0");
          if (!Number.isNaN(time) && time > 0) {
            sceneChanges.push(time);
          }
        }

        sceneChanges.push(duration);
        const uniqueScenes = [...new Set(sceneChanges)].sort((a, b) => a - b);

        for (let i = 0; i < uniqueScenes.length - 1; i++) {
          const start = uniqueScenes[i]!;
          const end = uniqueScenes[i + 1]!;
          if (end <= start) continue;

          const sceneDuration = end - start;
          const midPoint = duration / 2;
          const distanceFromCenter = Math.abs((start + end) / 2 - midPoint) / Math.max(midPoint, 1);
          const durationScore = Math.max(0, 1 - sceneDuration / Math.max(duration * 0.1, 1));
          const positionScore = 1 - distanceFromCenter;
          const significance = parseFloat((durationScore * 0.3 + positionScore * 0.7).toFixed(3));

          scenes.push({
            start: parseFloat(start.toFixed(3)),
            end: parseFloat(end.toFixed(3)),
            significance: Math.min(1, Math.max(0, significance)),
          });
        }

        resolve(scenes);
      });

      proc.on("error", (error) => {
        reject(new Error(`ffmpeg scene detection error: ${error.message}`));
      });
    });
  } catch {
    return buildFallbackScenes(duration);
  }
}

export async function extractKeyframes(videoPath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffprobeInstaller.path, [
      "-v",
      "error",
      "-skip_frame",
      "nokey",
      "-select_streams",
      "v:0",
      "-show_frames",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "csv=p=0",
      videoPath,
    ]);
    const stderr = cappedStderr(proc);
    let stdout = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe keyframes failed (code ${code}): ${stderr.get().slice(-500)}`));
        return;
      }

      const keyframes = stdout
        .split(/\r?\n/)
        .map((line) => parseFloat(line.trim()))
        .filter((value) => Number.isFinite(value))
        .map((value) => parseFloat(value.toFixed(3)));

      resolve([...new Set(keyframes)].sort((a, b) => a - b));
    });

    proc.on("error", (error) => {
      reject(new Error(`ffprobe process error: ${error.message}`));
    });
  });
}

export async function sampleFrames(
  videoPath: string,
  outputDir: string,
  duration: number,
  intervalSeconds: number = DEFAULT_FRAME_INTERVAL_SECONDS,
): Promise<SampledFrame[]> {
  fs.mkdirSync(outputDir, { recursive: true });

  const timestamps: number[] = [];
  for (let current = 0; current < duration; current += intervalSeconds) {
    timestamps.push(parseFloat(current.toFixed(3)));
  }

  if (timestamps.length === 0 || timestamps[timestamps.length - 1]! < duration) {
    timestamps.push(parseFloat(Math.max(0, duration - 0.001).toFixed(3)));
  }

  const frames: SampledFrame[] = [];

  for (const timestamp of timestamps) {
    const filename = `frame_${timestamp.toFixed(3).replace(/\./g, "_")}.jpg`;
    const outputPath = path.join(outputDir, filename);

    await new Promise<void>((resolve, reject) => {
      const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
        "-ss",
        String(timestamp),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-y",
        outputPath,
      ]);
      const stderr = cappedStderr(proc);

      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg frame extraction failed (code ${code}): ${stderr.get().slice(-500)}`));
      });

      proc.on("error", (error) => {
        reject(new Error(`ffmpeg process error: ${error.message}`));
      });
    });

    frames.push({ timestamp, path: outputPath });
  }

  return frames;
}

function findNearestKeyframe(time: number, keyframes: number[]): number | undefined {
  let nearest: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const keyframe of keyframes) {
    const distance = Math.abs(keyframe - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = keyframe;
    }
  }

  return nearest;
}

export function evaluateCopySafety(start: number, end: number, keyframes: number[]): {
  copySafe: boolean;
  copyStart?: number;
  copyEnd?: number;
} {
  const nearestStart = findNearestKeyframe(start, keyframes);
  const nearestEnd = findNearestKeyframe(end, keyframes);

  if (
    nearestStart === undefined ||
    nearestEnd === undefined ||
    Math.abs(nearestStart - start) > COPY_SAFE_TOLERANCE_SECONDS ||
    Math.abs(nearestEnd - end) > COPY_SAFE_TOLERANCE_SECONDS ||
    nearestEnd <= nearestStart
  ) {
    return { copySafe: false };
  }

  return {
    copySafe: true,
    copyStart: parseFloat(nearestStart.toFixed(3)),
    copyEnd: parseFloat(nearestEnd.toFixed(3)),
  };
}

export async function writeClipFile(
  videoPath: string,
  outputPath: string,
  clip: ProposedClip,
): Promise<void> {
  const useStreamCopy =
    clip.strategy === "stream-copy" &&
    clip.copySafe &&
    clip.copyStart !== undefined &&
    clip.copyEnd !== undefined;
  const start = useStreamCopy ? clip.copyStart! : clip.start;
  const end = useStreamCopy ? clip.copyEnd! : clip.end;
  const duration = end - start;

  if (duration <= 0) {
    throw new Error(`Invalid clip duration for ${outputPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const args = useStreamCopy
      ? [
          "-ss",
          String(start),
          "-i",
          videoPath,
          "-t",
          String(duration),
          "-c",
          "copy",
          "-avoid_negative_ts",
          "make_zero",
          "-y",
          outputPath,
        ]
      : [
          "-i",
          videoPath,
          "-ss",
          String(start),
          "-t",
          String(duration),
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "18",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-avoid_negative_ts",
          "make_zero",
          "-y",
          outputPath,
        ];

    const { proc } = spawnWithTimeout(ffmpegInstaller.path, args);
    const stderr = cappedStderr(proc);

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg clip write failed (code ${code}): ${stderr.get().slice(-500)}`));
    });

    proc.on("error", (error) => {
      reject(new Error(`ffmpeg process error: ${error.message}`));
    });
  });

  const stat = fs.statSync(outputPath);
  if (stat.size <= 0) {
    throw new Error(`Clip file is empty: ${outputPath}`);
  }
}
