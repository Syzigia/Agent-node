import { z } from "zod";

/**
 * Smart Highlights Clipper - Shared TypeScript Interfaces and Zod Schemas
 * 
 * This file defines all types used across the smart highlights workflow tools.
 */

// ============================================================================
// Audio Extraction
// ============================================================================

export const audioExtractionInputSchema = z.object({
  videoPath: z.string().describe("Absolute path to the video file"),
  outputPath: z.string().describe("Absolute path for the output MP3 file"),
});

export const audioExtractionOutputSchema = z.object({
  audioPath: z.string(),
  duration: z.number(),
  hasAudio: z.boolean(),
});

export type AudioExtractionInput = z.infer<typeof audioExtractionInputSchema>;
export type AudioExtractionOutput = z.infer<typeof audioExtractionOutputSchema>;

// ============================================================================
// Transcription
// ============================================================================

export const transcriptionSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
});

export const transcriptionInputSchema = z.object({
  audioPath: z.string().describe("Absolute path to the audio file"),
  maxChunkSizeMB: z.number().optional().default(25),
});

export const transcriptionOutputSchema = z.object({
  segments: z.array(transcriptionSegmentSchema),
});

export type TranscriptionSegment = z.infer<typeof transcriptionSegmentSchema>;
export type TranscriptionInput = z.infer<typeof transcriptionInputSchema>;
export type TranscriptionOutput = z.infer<typeof transcriptionOutputSchema>;

// ============================================================================
// Visual Analysis
// ============================================================================

export const visualSceneSchema = z.object({
  start: z.number(),
  end: z.number(),
  significance: z.number().min(0).max(1),
});

export const visualAnalysisInputSchema = z.object({
  videoPath: z.string().describe("Absolute path to the video file"),
  sceneThreshold: z.number().optional().default(0.3),
});

export const visualAnalysisOutputSchema = z.object({
  scenes: z.array(visualSceneSchema),
});

export type VisualScene = z.infer<typeof visualSceneSchema>;
export type VisualAnalysisInput = z.infer<typeof visualAnalysisInputSchema>;
export type VisualAnalysisOutput = z.infer<typeof visualAnalysisOutputSchema>;

// ============================================================================
// Scoring
// ============================================================================

export const contentTypeSchema = z.enum(["visual", "textual"]);

export const momentSchema = z.object({
  start: z.number(),
  end: z.number(),
  textScore: z.number().min(0).max(1),
  visualScore: z.number().min(0).max(1),
  combinedScore: z.number().min(0).max(1),
});

export const scoringInputSchema = z.object({
  segments: z.array(transcriptionSegmentSchema),
  scenes: z.array(visualSceneSchema),
  contentType: contentTypeSchema,
  videoDuration: z.number(),
});

export const scoringOutputSchema = z.object({
  moments: z.array(momentSchema),
});

export type ContentType = z.infer<typeof contentTypeSchema>;
export type Moment = z.infer<typeof momentSchema>;
export type ScoringInput = z.infer<typeof scoringInputSchema>;
export type ScoringOutput = z.infer<typeof scoringOutputSchema>;

// ============================================================================
// Clip Generation
// ============================================================================

export const clipCandidateSchema = z.object({
  start: z.number(),
  end: z.number(),
  filename: z.string(),
});

export const generatedClipSchema = z.object({
  filename: z.string(),
  path: z.string(),
  duration: z.number(),
});

export const failedClipSchema = z.object({
  start: z.number(),
  end: z.number(),
  error: z.string(),
});

export const clipGeneratorInputSchema = z.object({
  videoPath: z.string(),
  clips: z.array(clipCandidateSchema),
  outputFolder: z.string(),
});

export const clipGeneratorOutputSchema = z.object({
  clips: z.array(generatedClipSchema),
  failedClips: z.array(failedClipSchema),
});

export type ClipCandidate = z.infer<typeof clipCandidateSchema>;
export type GeneratedClip = z.infer<typeof generatedClipSchema>;
export type FailedClip = z.infer<typeof failedClipSchema>;
export type ClipGeneratorInput = z.infer<typeof clipGeneratorInputSchema>;
export type ClipGeneratorOutput = z.infer<typeof clipGeneratorOutputSchema>;

// ============================================================================
// Cleanup
// ============================================================================

export const cleanupInputSchema = z.object({
  tempFiles: z.array(z.string()),
});

export const cleanupOutputSchema = z.object({
  success: z.boolean(),
  deletedFiles: z.array(z.string()),
  failedFiles: z.array(z.object({
    path: z.string(),
    error: z.string(),
  })),
});

export type CleanupInput = z.infer<typeof cleanupInputSchema>;
export type CleanupOutput = z.infer<typeof cleanupOutputSchema>;

// ============================================================================
// Workflow Configuration
// ============================================================================

export const workflowConfigSchema = z.object({
  file: z.string(),
  numberOfClips: z.number().min(1).max(20),
  targetDuration: z.number().min(5).max(300),
  contentType: contentTypeSchema,
  outputFolder: z.string().default("highlights"),
});

export const workflowOutputSchema = z.object({
  success: z.boolean(),
  outputFolder: z.string(),
  clipsGenerated: z.number(),
  clips: z.array(generatedClipSchema),
  originalVideo: z.string(),
  processingTime: z.number(),
});

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;

// ============================================================================
// Step Input/Output Schemas (for workflow steps)
// ============================================================================

export const configStepInputSchema = z.object({
  file: z.string().describe("Relative path to video file"),
});

export const configStepOutputSchema = z.object({
  file: z.string(),
  numberOfClips: z.number().min(1).max(20),
  targetDuration: z.number().min(5).max(300),
  contentType: contentTypeSchema,
  outputFolder: z.string(),
});

export const selectStepOutputSchema = z.object({
  clips: z.array(z.object({
    start: z.number(),
    end: z.number(),
    reason: z.string(),
  })),
});

export type SelectStepOutput = z.infer<typeof selectStepOutputSchema>;
