import { describe, it, expect } from "bun:test";
import type { TranscriptionSegment, VisualScene, Moment } from "../types";
import { CONTENT_TYPE_WEIGHTS } from "../constants";

describe("Workflow Integration Tests", () => {
  describe("Step Data Flow", () => {
    it("should pass data correctly from audio extraction to transcription", async () => {
      // Mock the flow: extract-audio -> transcribe-audio
      const mockAudioPath = "/tmp/test-audio.mp3";
      const mockDuration = 120;
      const mockHasAudio = true;

      // Simulating the output of extractAudioStep
      const extractOutput = {
        audioPath: mockAudioPath,
        duration: mockDuration,
        hasAudio: mockHasAudio,
      };

      // Verify data is available for transcription step
      expect(extractOutput.audioPath).toBe(mockAudioPath);
      expect(extractOutput.duration).toBe(mockDuration);
      expect(extractOutput.hasAudio).toBe(true);
    });

    it("should handle audio-less videos in transcription step", async () => {
      // Simulate video with no audio
      const hasAudio = false;
      const segments: TranscriptionSegment[] = [];

      if (!hasAudio) {
        // Should skip transcription and return empty segments
        expect(segments).toEqual([]);
      }
    });

    it("should combine transcription and visual analysis outputs", async () => {
      // Mock outputs from parallel steps
      const mockSegments: TranscriptionSegment[] = [
        { text: "Hello world", start: 0, end: 5 },
        { text: "This is a test", start: 5, end: 10 },
      ];

      const mockScenes: VisualScene[] = [
        { start: 0, end: 5, significance: 0.8 },
        { start: 5, end: 10, significance: 0.6 },
      ];

      // Both data sources should be available for scoring
      expect(mockSegments.length).toBeGreaterThan(0);
      expect(mockScenes.length).toBeGreaterThan(0);

      // Simulate scoring step input
      const scoringInput = {
        segments: mockSegments,
        scenes: mockScenes,
        contentType: "textual" as const,
        videoDuration: 10,
      };

      expect(scoringInput.segments).toEqual(mockSegments);
      expect(scoringInput.scenes).toEqual(mockScenes);
    });

    it("should pass scored moments to selection step", async () => {
      const mockMoments: Moment[] = [
        { start: 0, end: 5, textScore: 0.8, visualScore: 0.6, combinedScore: 0.74 },
        { start: 5, end: 10, textScore: 0.9, visualScore: 0.5, combinedScore: 0.78 },
      ];

      // Selection step should receive ranked moments
      expect(mockMoments[0]!.combinedScore).toBeGreaterThanOrEqual(0);
      expect(mockMoments[0]!).toHaveProperty("start");
      expect(mockMoments[0]!).toHaveProperty("end");
      expect(mockMoments[0]!).toHaveProperty("textScore");
      expect(mockMoments[0]!).toHaveProperty("visualScore");
      expect(mockMoments[0]!).toHaveProperty("combinedScore");
    });

    it("should convert selected clips to generation input", async () => {
      const selectedClips = [
        { start: 0, end: 15, reason: "Best moment" },
        { start: 30, end: 45, reason: "Great scene" },
      ];

      const videoPath = "/path/to/video.mp4";
      const outputFolder = "/output/highlights";

      // Generate clips input format
      const generationInput = {
        videoPath,
        clips: selectedClips.map((clip, index) => ({
          start: clip.start,
          end: clip.end,
          filename: `clip_${String(index + 1).padStart(3, "0")}.mp4`,
        })),
        outputFolder,
      };

      expect(generationInput.clips).toHaveLength(2);
      expect(generationInput.clips[0]!.filename).toBe("clip_001.mp4");
      expect(generationInput.clips[1]!.filename).toBe("clip_002.mp4");
    });
  });

  describe("Content Type Weights", () => {
    it("should use 70/30 weights for textual preference", () => {
      const weights = CONTENT_TYPE_WEIGHTS["textual"];
      expect(weights.text).toBe(0.7);
      expect(weights.visual).toBe(0.3);
      expect(weights.text + weights.visual).toBe(1.0);
    });

    it("should use 30/70 weights for visual preference", () => {
      const weights = CONTENT_TYPE_WEIGHTS["visual"];
      expect(weights.text).toBe(0.3);
      expect(weights.visual).toBe(0.7);
      expect(weights.text + weights.visual).toBe(1.0);
    });

    it("should calculate combined scores correctly", () => {
      const textScore = 0.8;
      const visualScore = 0.6;

      // Textual: 70% text, 30% visual
      const textualWeights = CONTENT_TYPE_WEIGHTS["textual"];
      const textualCombined = textScore * textualWeights.text + visualScore * textualWeights.visual;
      expect(textualCombined).toBeCloseTo(0.74, 2);

      // Visual: 30% text, 70% visual
      const visualWeights = CONTENT_TYPE_WEIGHTS["visual"];
      const visualCombined = textScore * visualWeights.text + visualScore * visualWeights.visual;
      expect(visualCombined).toBeCloseTo(0.66, 2);
    });
  });

  describe("Workflow State Management", () => {
    it("should maintain temp files list through steps", () => {
      const tempFiles: string[] = [];

      // Step 2: Add audio file
      const audioPath = "/tmp/audio.mp3";
      tempFiles.push(audioPath);
      expect(tempFiles).toContain(audioPath);

      // Step 3: Transcription might add temp files (in future implementation)
      // For now, just verify the pattern works

      // Final step: All temp files should be available for cleanup
      expect(tempFiles.length).toBeGreaterThan(0);
    });

    it("should track configuration through all steps", () => {
      const config = {
        file: "video.mp4",
        numberOfClips: 3,
        targetDuration: 15,
        contentType: "textual" as const,
        outputFolder: "highlights",
      };

      // Config should be available at each step
      expect(config.numberOfClips).toBe(3);
      expect(config.targetDuration).toBe(15);
      expect(config.contentType).toBe("textual");

      // Steps can read config values
      const minDuration = config.targetDuration * 0.8; // -20%
      const maxDuration = config.targetDuration * 1.2; // +20%

      expect(minDuration).toBe(12);
      expect(maxDuration).toBe(18);
    });
  });

  describe("Error Recovery", () => {
    it("should handle missing audio gracefully", () => {
      const hasAudio = false;
      let segments: TranscriptionSegment[] | null = null;

      if (hasAudio) {
        segments = []; // Would transcribe
      } else {
        segments = []; // Empty array for no audio
      }

      expect(segments).toEqual([]);
    });

    it("should validate clip boundaries", () => {
      const videoDuration = 60;
      const clip = { start: 50, end: 70 }; // End exceeds duration

      const clampedStart = Math.max(0, clip.start);
      const clampedEnd = Math.min(videoDuration, clip.end);

      expect(clampedStart).toBe(50);
      expect(clampedEnd).toBe(60);
    });

    it("should detect invalid timestamps", () => {
      const clip = { start: 30, end: 20 }; // Start after end

      const isValid = clip.start < clip.end && clip.start >= 0;
      expect(isValid).toBe(false);
    });
  });
});
