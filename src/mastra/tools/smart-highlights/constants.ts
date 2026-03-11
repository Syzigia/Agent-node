/**
 * Smart Highlights Clipper - Constants
 * 
 * This file defines all constants used across the smart highlights workflow tools.
 */

import path from "path";
import os from "os";

// ============================================================================
// File Size and Chunking
// ============================================================================

/** Maximum chunk size in MB for Whisper API (OpenAI limit is 25MB) */
export const MAX_CHUNK_SIZE_MB = 25;

/** Maximum chunk size in bytes */
export const MAX_CHUNK_SIZE_BYTES = MAX_CHUNK_SIZE_MB * 1024 * 1024;

/** Overlap between audio chunks in seconds to ensure no gaps in transcription */
export const CHUNK_OVERLAP_SECONDS = 5;

// ============================================================================
// Visual Analysis
// ============================================================================

/** Default threshold for FFmpeg scene detection (0.0 - 1.0) */
export const DEFAULT_SCENE_THRESHOLD = 0.3;

/** Number of frames to sample when falling back to uniform sampling */
export const UNIFORM_SAMPLE_FRAMES = 100;

// ============================================================================
// Output and File Management
// ============================================================================

/** Default output folder for generated clips */
export const DEFAULT_OUTPUT_FOLDER = "highlights";

/** Prefix for temporary files */
export const TEMP_FILE_PREFIX = "smart-highlights-";

/** Temporary directory for intermediate files */
export const TEMP_DIR = path.join(os.tmpdir(), TEMP_FILE_PREFIX);

// ============================================================================
// Retry and Error Handling
// ============================================================================

/** Number of retry attempts for API calls and FFmpeg operations */
export const RETRY_ATTEMPTS = 3;

/** Delay between retries in milliseconds */
export const RETRY_DELAY_MS = 1000;

// ============================================================================
// Content Type Weights
// ============================================================================

/**
 * Weight configuration for different content types.
 * Weights should sum to 1.0 for each content type.
 */
export const CONTENT_TYPE_WEIGHTS = {
  /** Textual content: prioritize transcription analysis (70% text, 30% visual) */
  textual: {
    text: 0.7,
    visual: 0.3,
  },
  /** Visual content: prioritize visual analysis (30% text, 70% visual) */
  visual: {
    text: 0.3,
    visual: 0.7,
  },
} as const;

/** Default content type when not specified */
export const DEFAULT_CONTENT_TYPE = "textual" as const;

// ============================================================================
// Clip Generation
// ============================================================================

/** Tolerance for target duration (±20%) */
export const TARGET_DURATION_TOLERANCE = 0.2;

/** Adjustment amount for retry on clip generation failure (seconds) */
export const CLIP_RETRY_ADJUSTMENT = 0.5;

/** Maximum clip duration in seconds */
export const MAX_CLIP_DURATION = 300;

/** Minimum clip duration in seconds */
export const MIN_CLIP_DURATION = 5;

/** Maximum number of clips */
export const MAX_CLIPS = 20;

/** Minimum number of clips */
export const MIN_CLIPS = 1;

// ============================================================================
// Cost Estimation
// ============================================================================

/** Approximate Whisper API cost per minute of audio (in USD) */
export const WHISPER_COST_PER_MINUTE = 0.006;

/** Warning threshold for video length (in minutes) - shows cost warning */
export const COST_WARNING_THRESHOLD_MINUTES = 10;

// ============================================================================
// FFmpeg Settings
// ============================================================================

/** Audio codec for extraction */
export const AUDIO_CODEC = "libmp3lame";

/** Audio bitrate for extraction (64k sufficient for Whisper speech recognition) */
export const AUDIO_BITRATE = "64k";

/** Audio sample rate (16kHz — Whisper's native rate; 44.1kHz wastes 2.75x bandwidth) */
export const AUDIO_SAMPLE_RATE = 16000;

/** Video codec copy flag for clip generation (preserves original quality) */
export const VIDEO_CODEC_COPY = "copy";

/** Audio codec copy flag for clip generation (preserves original quality) */
export const AUDIO_CODEC_COPY = "copy";

// ============================================================================
// Clip Re-encoding Settings
// ============================================================================

/** Video codec for re-encoded clip generation (frame-accurate cuts) */
export const CLIP_VIDEO_CODEC = "libx264";

/** Video encoding preset (fast = good balance of speed and compression) */
export const CLIP_VIDEO_PRESET = "fast";

/** Video CRF (Constant Rate Factor): 18 = visually lossless */
export const CLIP_VIDEO_CRF = "18";

/** Audio codec for re-encoded clip generation */
export const CLIP_AUDIO_CODEC = "aac";

/** Audio bitrate for re-encoded clips */
export const CLIP_AUDIO_BITRATE = "192k";

/** Minimum valid clip file size in bytes (10 KB) — anything smaller is corrupt */
export const MIN_CLIP_FILE_SIZE = 10 * 1024;
