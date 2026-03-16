import { z } from "zod";

export const transcriptionWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

export const transcriptionSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
});

export const sceneBoundarySchema = z.object({
  start: z.number(),
  end: z.number(),
  significance: z.number().min(0).max(1),
});

export const sampledFrameSchema = z.object({
  timestamp: z.number(),
  path: z.string(),
});

export const analysisWindowSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  transcript: z.string(),
  wordCount: z.number(),
  frames: z.array(sampledFrameSchema),
  sceneCount: z.number(),
  keyframeCount: z.number(),
  heuristicScore: z.number(),
  emphasisSignals: z.array(z.string()),
});

export const multimodalAssessmentSchema = z.object({
  score: z.number().min(0).max(1),
  hookStrength: z.number().min(0).max(1),
  semanticImportance: z.number().min(0).max(1),
  visualEnergy: z.number().min(0).max(1),
  startOffsetSeconds: z.number().min(0).max(4),
  endOffsetSeconds: z.number().min(0).max(4),
  keepWindowWhole: z.boolean(),
  reason: z.string(),
  textSignals: z.array(z.string()).max(5),
  visualSignals: z.array(z.string()).max(5),
});

export const proposedClipSchema = z.object({
  start: z.number(),
  end: z.number(),
  reason: z.string(),
  score: z.number().min(0).max(1),
  sourceWindowId: z.string(),
  copySafe: z.boolean(),
  copyStart: z.number().optional(),
  copyEnd: z.number().optional(),
  strategy: z.enum(["stream-copy", "reencode"]),
  textSignals: z.array(z.string()),
  visualSignals: z.array(z.string()),
});

export const generatedClipSchema = z.object({
  filename: z.string(),
  path: z.string(),
  duration: z.number(),
  strategy: z.enum(["stream-copy", "reencode"]),
});

export const failedClipSchema = z.object({
  start: z.number(),
  end: z.number(),
  error: z.string(),
});

export type TranscriptionWord = z.infer<typeof transcriptionWordSchema>;
export type TranscriptionSegment = z.infer<typeof transcriptionSegmentSchema>;
export type SceneBoundary = z.infer<typeof sceneBoundarySchema>;
export type SampledFrame = z.infer<typeof sampledFrameSchema>;
export type AnalysisWindow = z.infer<typeof analysisWindowSchema>;
export type MultimodalAssessment = z.infer<typeof multimodalAssessmentSchema>;
export type ProposedClip = z.infer<typeof proposedClipSchema>;
export type GeneratedClip = z.infer<typeof generatedClipSchema>;
export type FailedClip = z.infer<typeof failedClipSchema>;
