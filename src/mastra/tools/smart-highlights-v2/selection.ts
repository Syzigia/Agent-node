import type {
  AnalysisWindow,
  MultimodalAssessment,
  ProposedClip,
  SceneBoundary,
  TranscriptionSegment,
  TranscriptionWord,
  SampledFrame,
} from "./types";
import {
  DEFAULT_PREVIEW_WINDOWS,
  DEFAULT_WINDOW_DURATION_SECONDS,
  DEFAULT_WINDOW_STEP_SECONDS,
  DURATION_LOWER_TOLERANCE,
  DURATION_UPPER_TOLERANCE,
  MIN_GAP_BETWEEN_CLIPS_SECONDS,
} from "./constants";
import { evaluateCopySafety } from "./media";

export interface RankedWindow extends AnalysisWindow {
  assessment?: MultimodalAssessment;
}

function getRangeOverlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function sliceTranscript(segments: TranscriptionSegment[], start: number, end: number): string {
  return segments
    .filter((segment) => getRangeOverlap(start, end, segment.start, segment.end) > 0)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
}

function collectWords(words: TranscriptionWord[], start: number, end: number): TranscriptionWord[] {
  return words.filter((word) => getRangeOverlap(start, end, word.start, word.end) > 0);
}

function collectFrames(frames: SampledFrame[], start: number, end: number): SampledFrame[] {
  return frames.filter((frame) => frame.timestamp >= start && frame.timestamp < end).slice(0, 5);
}

function collectScenes(scenes: SceneBoundary[], start: number, end: number): SceneBoundary[] {
  return scenes.filter((scene) => getRangeOverlap(start, end, scene.start, scene.end) > 0);
}

function collectKeyframes(keyframes: number[], start: number, end: number): number[] {
  return keyframes.filter((keyframe) => keyframe >= start && keyframe <= end);
}

function buildEmphasisSignals(transcript: string, words: TranscriptionWord[], scenes: SceneBoundary[]): string[] {
  const signals: string[] = [];
  const normalized = transcript.toLowerCase();

  if (/!|\?/.test(transcript)) signals.push("punctuation emphasis");
  if (/(problem|grave|urgent|importante|critico|critical|massive|huge|warning)/.test(normalized)) {
    signals.push("high-stakes language");
  }
  if (/(look|watch|mira|observe|here|aqui|this is|esto es)/.test(normalized)) {
    signals.push("presentation cue");
  }
  if (words.length >= 25) signals.push("dense spoken content");
  if (scenes.length >= 2) signals.push("multiple scene changes");

  return signals;
}

export function buildAnalysisWindows(params: {
  duration: number;
  words: TranscriptionWord[];
  segments: TranscriptionSegment[];
  scenes: SceneBoundary[];
  frames: SampledFrame[];
  keyframes: number[];
  targetDuration: number;
}): AnalysisWindow[] {
  const {
    duration,
    words,
    segments,
    scenes,
    frames,
    keyframes,
    targetDuration,
  } = params;

  const windowDuration = Math.min(Math.max(DEFAULT_WINDOW_DURATION_SECONDS, targetDuration / 3), 18);
  const step = Math.min(DEFAULT_WINDOW_STEP_SECONDS, Math.max(3, windowDuration / 2));
  const windows: AnalysisWindow[] = [];

  for (let start = 0; start < duration; start += step) {
    const end = Math.min(duration, start + windowDuration);
    if (end - start < 4) continue;

    const windowWords = collectWords(words, start, end);
    const windowTranscript = sliceTranscript(segments, start, end);
    const windowScenes = collectScenes(scenes, start, end);
    const windowFrames = collectFrames(frames, start, end);
    const windowKeyframes = collectKeyframes(keyframes, start, end);
    const emphasisSignals = buildEmphasisSignals(windowTranscript, windowWords, windowScenes);
    const speechDensity = windowWords.length / Math.max(1, end - start);
    const sceneBoost = Math.min(1, windowScenes.length / 3);
    const frameBoost = Math.min(1, windowFrames.length / 5);
    const transcriptBoost = Math.min(1, windowTranscript.length / 180);
    const keyframeBoost = Math.min(1, windowKeyframes.length / 4);
    const emphasisBoost = Math.min(1, emphasisSignals.length / 3);
    const heuristicScore = parseFloat(
      (
        speechDensity * 0.08 +
        sceneBoost * 0.2 +
        frameBoost * 0.15 +
        transcriptBoost * 0.22 +
        keyframeBoost * 0.1 +
        emphasisBoost * 0.25
      ).toFixed(3),
    );

    windows.push({
      id: `window_${windows.length.toString().padStart(3, "0")}`,
      start: parseFloat(start.toFixed(3)),
      end: parseFloat(end.toFixed(3)),
      transcript: windowTranscript,
      wordCount: windowWords.length,
      frames: windowFrames,
      sceneCount: windowScenes.length,
      keyframeCount: windowKeyframes.length,
      heuristicScore,
      emphasisSignals,
    });
  }

  return windows.sort((a, b) => b.heuristicScore - a.heuristicScore);
}

export function selectPreviewWindows(windows: AnalysisWindow[], count: number = DEFAULT_PREVIEW_WINDOWS): AnalysisWindow[] {
  return windows.slice(0, count);
}

function nearestSceneBoundary(time: number, scenes: SceneBoundary[], side: "start" | "end"): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const scene of scenes) {
    const candidate = side === "start" ? scene.start : scene.end;
    const distance = Math.abs(candidate - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

function nearestWordBoundary(time: number, words: TranscriptionWord[], side: "start" | "end"): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const word of words) {
    const candidate = side === "start" ? word.start : word.end;
    const distance = Math.abs(candidate - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

function overlapExists(start: number, end: number, selected: ProposedClip[]): boolean {
  return selected.some((clip) => start < clip.end + MIN_GAP_BETWEEN_CLIPS_SECONDS && end > clip.start - MIN_GAP_BETWEEN_CLIPS_SECONDS);
}

export function buildProposedClips(params: {
  rankedWindows: RankedWindow[];
  targetDuration: number;
  numberOfClips: number;
  words: TranscriptionWord[];
  scenes: SceneBoundary[];
  keyframes: number[];
  duration: number;
}): ProposedClip[] {
  const { rankedWindows, targetDuration, numberOfClips, words, scenes, keyframes, duration } = params;
  const selected: ProposedClip[] = [];
  const minDuration = Math.max(8, targetDuration * DURATION_LOWER_TOLERANCE);
  const maxDuration = targetDuration * DURATION_UPPER_TOLERANCE;

  for (const window of rankedWindows) {
    if (selected.length >= numberOfClips) break;

    const assessment = window.assessment;
    const startOffset = assessment?.startOffsetSeconds ?? 0;
    const endOffset = assessment?.endOffsetSeconds ?? 0;
    let clipStart = Math.max(0, window.start - startOffset);
    let clipEnd = Math.min(duration, window.end + endOffset);

    const targetMid = (window.start + window.end) / 2;
    let desiredDuration = assessment?.keepWindowWhole ? clipEnd - clipStart : targetDuration;
    desiredDuration = Math.min(maxDuration, Math.max(minDuration, desiredDuration));

    clipStart = Math.max(0, targetMid - desiredDuration / 2);
    clipEnd = Math.min(duration, clipStart + desiredDuration);

    const sceneStart = nearestSceneBoundary(clipStart, scenes, "start");
    const sceneEnd = nearestSceneBoundary(clipEnd, scenes, "end");
    const wordStart = nearestWordBoundary(clipStart, words, "start");
    const wordEnd = nearestWordBoundary(clipEnd, words, "end");

    if (sceneStart !== undefined && Math.abs(sceneStart - clipStart) <= 1.2) clipStart = sceneStart;
    else if (wordStart !== undefined && Math.abs(wordStart - clipStart) <= 0.8) clipStart = wordStart;

    if (sceneEnd !== undefined && Math.abs(sceneEnd - clipEnd) <= 1.2) clipEnd = sceneEnd;
    else if (wordEnd !== undefined && Math.abs(wordEnd - clipEnd) <= 0.8) clipEnd = wordEnd;

    if (clipEnd - clipStart < minDuration) {
      clipEnd = Math.min(duration, clipStart + minDuration);
    }
    if (clipEnd - clipStart > maxDuration) {
      clipEnd = clipStart + maxDuration;
    }
    if (clipEnd > duration) {
      const overflow = clipEnd - duration;
      clipStart = Math.max(0, clipStart - overflow);
      clipEnd = duration;
    }

    clipStart = parseFloat(clipStart.toFixed(3));
    clipEnd = parseFloat(clipEnd.toFixed(3));

    if (clipEnd <= clipStart || overlapExists(clipStart, clipEnd, selected)) {
      continue;
    }

    const copyEvaluation = evaluateCopySafety(clipStart, clipEnd, keyframes);
    const score = parseFloat((assessment?.score ?? window.heuristicScore).toFixed(3));

    selected.push({
      start: clipStart,
      end: clipEnd,
      reason: assessment?.reason ?? `Strong transcript and visual cues in ${window.id}`,
      score,
      sourceWindowId: window.id,
      copySafe: copyEvaluation.copySafe,
      copyStart: copyEvaluation.copyStart,
      copyEnd: copyEvaluation.copyEnd,
      strategy: copyEvaluation.copySafe ? "stream-copy" : "reencode",
      textSignals: assessment?.textSignals ?? window.emphasisSignals,
      visualSignals: assessment?.visualSignals ?? [
        `${window.sceneCount} scene cues`,
        `${window.frames.length} sampled frames`,
      ],
    });
  }

  return selected.sort((a, b) => a.start - b.start);
}
