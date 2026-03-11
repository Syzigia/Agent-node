/**
 * Smart Highlights Clipper - Tools Index
 * 
 * This file exports all helper functions for the smart highlights workflow.
 */

// Core function exports
export { checkAudioStream, extractAudioToMp3, getAudioDuration } from "./tools/extract-audio";
export { transcribeChunk } from "./tools/transcribe-audio";
export { getVideoDuration, detectScenesWithFallback, createUniformScenes } from "./tools/analyze-visual";
export { scoreClips, createUnifiedMoments, calculateTextScore, calculateVisualScore } from "./tools/score-clips";
export { generateSingleClip } from "./tools/generate-clips";
export { cleanupFiles } from "./tools/cleanup";

// Type exports
export type {
  AudioExtractionInput,
  AudioExtractionOutput,
  TranscriptionInput,
  TranscriptionOutput,
  TranscriptionSegment,
  VisualAnalysisInput,
  VisualAnalysisOutput,
  VisualScene,
  ScoringInput,
  ScoringOutput,
  Moment,
  ContentType,
  ClipGeneratorInput,
  ClipGeneratorOutput,
  ClipCandidate,
  GeneratedClip,
  FailedClip,
  CleanupInput,
  CleanupOutput,
  WorkflowConfig,
  WorkflowOutput,
  SelectStepOutput,
} from "./types";

// Schema exports (for use in workflow steps)
export {
  audioExtractionInputSchema,
  audioExtractionOutputSchema,
  transcriptionInputSchema,
  transcriptionOutputSchema,
  transcriptionSegmentSchema,
  visualAnalysisInputSchema,
  visualAnalysisOutputSchema,
  visualSceneSchema,
  scoringInputSchema,
  scoringOutputSchema,
  momentSchema,
  contentTypeSchema,
  clipGeneratorInputSchema,
  clipGeneratorOutputSchema,
  clipCandidateSchema,
  generatedClipSchema,
  failedClipSchema,
  cleanupInputSchema,
  cleanupOutputSchema,
  workflowConfigSchema,
  workflowOutputSchema,
  configStepInputSchema,
  configStepOutputSchema,
  selectStepOutputSchema,
} from "./types";

// Constants exports
export {
  MAX_CHUNK_SIZE_MB,
  MAX_CHUNK_SIZE_BYTES,
  CHUNK_OVERLAP_SECONDS,
  DEFAULT_SCENE_THRESHOLD,
  UNIFORM_SAMPLE_FRAMES,
  DEFAULT_OUTPUT_FOLDER,
  TEMP_FILE_PREFIX,
  TEMP_DIR,
  RETRY_ATTEMPTS,
  RETRY_DELAY_MS,
  CONTENT_TYPE_WEIGHTS,
  DEFAULT_CONTENT_TYPE,
  TARGET_DURATION_TOLERANCE,
  CLIP_RETRY_ADJUSTMENT,
  MAX_CLIP_DURATION,
  MIN_CLIP_DURATION,
  MAX_CLIPS,
  MIN_CLIPS,
  WHISPER_COST_PER_MINUTE,
  COST_WARNING_THRESHOLD_MINUTES,
  AUDIO_CODEC,
  AUDIO_BITRATE,
  AUDIO_SAMPLE_RATE,
  VIDEO_CODEC_COPY,
  AUDIO_CODEC_COPY,
} from "./constants";

// Utility exports
export {
  generateTempPath,
  removeFiles,
  verifyDependencies,
  withRetry,
} from "./utils";
