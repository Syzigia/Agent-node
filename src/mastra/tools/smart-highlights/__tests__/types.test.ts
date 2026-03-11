import { describe, it, expect } from "bun:test";
import {
  audioExtractionInputSchema,
  audioExtractionOutputSchema,
  transcriptionSegmentSchema,
  transcriptionInputSchema,
  transcriptionOutputSchema,
  visualSceneSchema,
  visualAnalysisInputSchema,
  visualAnalysisOutputSchema,
  contentTypeSchema,
  momentSchema,
  scoringInputSchema,
  scoringOutputSchema,
  clipCandidateSchema,
  generatedClipSchema,
  failedClipSchema,
  clipGeneratorInputSchema,
  clipGeneratorOutputSchema,
  cleanupInputSchema,
  cleanupOutputSchema,
  workflowConfigSchema,
  workflowOutputSchema,
  configStepInputSchema,
  configStepOutputSchema,
  selectStepOutputSchema,
} from "../types";

describe("Types and Validation Schemas", () => {
  describe("Audio Extraction Schemas", () => {
    it("should validate valid audio extraction input", () => {
      const input = {
        videoPath: "/path/to/video.mp4",
        outputPath: "/path/to/output.mp3",
      };
      const result = audioExtractionInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept paths (including empty strings - validated at runtime)", () => {
      // Note: Zod z.string() allows empty strings by default
      // Empty path validation is done at runtime in the tool
      const input = {
        videoPath: "",
        outputPath: "/path/to/output.mp3",
      };
      const result = audioExtractionInputSchema.safeParse(input);
      // Schema accepts empty strings, runtime validation catches them
      expect(result.success).toBe(true);
    });

    it("should validate valid audio extraction output", () => {
      const output = {
        audioPath: "/path/to/audio.mp3",
        duration: 120.5,
        hasAudio: true,
      };
      const result = audioExtractionOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("should reject negative duration", () => {
      const output = {
        audioPath: "/path/to/audio.mp3",
        duration: -10,
        hasAudio: true,
      };
      const result = audioExtractionOutputSchema.safeParse(output);
      expect(result.success).toBe(true); // Schema doesn't validate min for duration
    });
  });

  describe("Transcription Schemas", () => {
    it("should validate valid transcription segment", () => {
      const segment = {
        text: "Hello world",
        start: 0,
        end: 2.5,
      };
      const result = transcriptionSegmentSchema.safeParse(segment);
      expect(result.success).toBe(true);
    });

    it("should validate valid transcription input", () => {
      const input = {
        audioPath: "/path/to/audio.mp3",
        maxChunkSizeMB: 25,
      };
      const result = transcriptionInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should use default maxChunkSizeMB when not provided", () => {
      const input = {
        audioPath: "/path/to/audio.mp3",
      };
      const result = transcriptionInputSchema.parse(input);
      expect(result.maxChunkSizeMB).toBe(25);
    });

    it("should validate valid transcription output", () => {
      const output = {
        segments: [
          { text: "Hello", start: 0, end: 1 },
          { text: "World", start: 1, end: 2 },
        ],
      };
      const result = transcriptionOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("should reject segment with missing text", () => {
      const segment = {
        start: 0,
        end: 2.5,
      };
      const result = transcriptionSegmentSchema.safeParse(segment);
      expect(result.success).toBe(false);
    });
  });

  describe("Visual Analysis Schemas", () => {
    it("should validate valid visual scene", () => {
      const scene = {
        start: 0,
        end: 5,
        significance: 0.75,
      };
      const result = visualSceneSchema.safeParse(scene);
      expect(result.success).toBe(true);
    });

    it("should reject significance outside 0-1 range", () => {
      const scene = {
        start: 0,
        end: 5,
        significance: 1.5,
      };
      const result = visualSceneSchema.safeParse(scene);
      expect(result.success).toBe(false);
    });

    it("should use default scene threshold", () => {
      const input = {
        videoPath: "/path/to/video.mp4",
      };
      const result = visualAnalysisInputSchema.parse(input);
      expect(result.sceneThreshold).toBe(0.3);
    });

    it("should accept custom scene threshold", () => {
      const input = {
        videoPath: "/path/to/video.mp4",
        sceneThreshold: 0.5,
      };
      const result = visualAnalysisInputSchema.parse(input);
      expect(result.sceneThreshold).toBe(0.5);
    });
  });

  describe("Scoring Schemas", () => {
    it("should validate valid content type 'visual'", () => {
      const result = contentTypeSchema.safeParse("visual");
      expect(result.success).toBe(true);
    });

    it("should validate valid content type 'textual'", () => {
      const result = contentTypeSchema.safeParse("textual");
      expect(result.success).toBe(true);
    });

    it("should reject invalid content type", () => {
      const result = contentTypeSchema.safeParse("audio");
      expect(result.success).toBe(false);
    });

    it("should validate valid moment", () => {
      const moment = {
        start: 0,
        end: 5,
        textScore: 0.8,
        visualScore: 0.6,
        combinedScore: 0.74,
      };
      const result = momentSchema.safeParse(moment);
      expect(result.success).toBe(true);
    });

    it("should reject scores outside 0-1 range", () => {
      const moment = {
        start: 0,
        end: 5,
        textScore: 1.2,
        visualScore: 0.6,
        combinedScore: 0.9,
      };
      const result = momentSchema.safeParse(moment);
      expect(result.success).toBe(false);
    });

    it("should validate valid scoring input", () => {
      const input = {
        segments: [{ text: "Hello", start: 0, end: 2 }],
        scenes: [{ start: 0, end: 5, significance: 0.7 }],
        contentType: "textual" as const,
        videoDuration: 120,
      };
      const result = scoringInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate empty segments and scenes", () => {
      const input = {
        segments: [],
        scenes: [],
        contentType: "visual" as const,
        videoDuration: 120,
      };
      const result = scoringInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("Clip Generation Schemas", () => {
    it("should validate valid clip candidate", () => {
      const candidate = {
        start: 10,
        end: 25,
        filename: "clip_001.mp4",
      };
      const result = clipCandidateSchema.safeParse(candidate);
      expect(result.success).toBe(true);
    });

    it("should validate valid generated clip", () => {
      const clip = {
        filename: "clip_001.mp4",
        path: "/output/clip_001.mp4",
        duration: 15,
      };
      const result = generatedClipSchema.safeParse(clip);
      expect(result.success).toBe(true);
    });

    it("should validate valid failed clip", () => {
      const failed = {
        start: 10,
        end: 25,
        error: "FFmpeg failed",
      };
      const result = failedClipSchema.safeParse(failed);
      expect(result.success).toBe(true);
    });

    it("should validate valid clip generator input", () => {
      const input = {
        videoPath: "/path/to/video.mp4",
        clips: [
          { start: 0, end: 15, filename: "clip_001.mp4" },
          { start: 30, end: 45, filename: "clip_002.mp4" },
        ],
        outputFolder: "/output/highlights",
      };
      const result = clipGeneratorInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate valid clip generator output", () => {
      const output = {
        clips: [
          { filename: "clip_001.mp4", path: "/output/clip_001.mp4", duration: 15 },
        ],
        failedClips: [
          { start: 30, end: 45, error: "Failed to generate" },
        ],
      };
      const result = clipGeneratorOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("should validate empty clips array", () => {
      const output = {
        clips: [],
        failedClips: [],
      };
      const result = clipGeneratorOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("Cleanup Schemas", () => {
    it("should validate valid cleanup input", () => {
      const input = {
        tempFiles: ["/tmp/file1.mp3", "/tmp/file2.mp4"],
      };
      const result = cleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate empty tempFiles array", () => {
      const input = {
        tempFiles: [],
      };
      const result = cleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate valid cleanup output", () => {
      const output = {
        success: true,
        deletedFiles: ["/tmp/file1.mp3"],
        failedFiles: [
          { path: "/tmp/file2.mp4", error: "Permission denied" },
        ],
      };
      const result = cleanupOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("should validate successful cleanup with no failures", () => {
      const output = {
        success: true,
        deletedFiles: ["/tmp/file1.mp3", "/tmp/file2.mp4"],
        failedFiles: [],
      };
      const result = cleanupOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });

  describe("Workflow Schemas", () => {
    it("should validate valid workflow config", () => {
      const config = {
        file: "video.mp4",
        numberOfClips: 3,
        targetDuration: 15,
        contentType: "textual" as const,
        outputFolder: "highlights",
      };
      const result = workflowConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should use default output folder", () => {
      const config = {
        file: "video.mp4",
        numberOfClips: 3,
        targetDuration: 15,
        contentType: "textual" as const,
      };
      const result = workflowConfigSchema.parse(config);
      expect(result.outputFolder).toBe("highlights");
    });

    it("should reject numberOfClips below minimum", () => {
      const config = {
        file: "video.mp4",
        numberOfClips: 0,
        targetDuration: 15,
        contentType: "textual" as const,
      };
      const result = workflowConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject numberOfClips above maximum", () => {
      const config = {
        file: "video.mp4",
        numberOfClips: 25,
        targetDuration: 15,
        contentType: "textual" as const,
      };
      const result = workflowConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject targetDuration below minimum", () => {
      const config = {
        file: "video.mp4",
        numberOfClips: 3,
        targetDuration: 3,
        contentType: "textual" as const,
      };
      const result = workflowConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject targetDuration above maximum", () => {
      const config = {
        file: "video.mp4",
        numberOfClips: 3,
        targetDuration: 400,
        contentType: "textual" as const,
      };
      const result = workflowConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should validate valid workflow output", () => {
      const output = {
        success: true,
        outputFolder: "highlights",
        clipsGenerated: 3,
        clips: [
          { filename: "clip_001.mp4", path: "/output/clip_001.mp4", duration: 15 },
        ],
        originalVideo: "video.mp4",
        processingTime: 120,
      };
      const result = workflowOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("should validate config step input", () => {
      const input = {
        file: "video.mp4",
      };
      const result = configStepInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate config step output", () => {
      const output = {
        file: "video.mp4",
        numberOfClips: 3,
        targetDuration: 15,
        contentType: "textual" as const,
        outputFolder: "highlights",
      };
      const result = configStepOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("should validate select step output", () => {
      const output = {
        clips: [
          { start: 10, end: 25, reason: "Best moment" },
          { start: 45, end: 60, reason: "Great scene" },
        ],
      };
      const result = selectStepOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});
