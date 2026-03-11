import { describe, it, expect } from "bun:test";
import { scoreClips, createUnifiedMoments, calculateTextScore, calculateVisualScore } from "../tools/score-clips";
import type { TranscriptionSegment, VisualScene } from "../types";

describe("score-clips Functions", () => {
  const mockSegments: TranscriptionSegment[] = [
    { text: "This is a test segment", start: 0, end: 5 },
    { text: "Another segment with more text content here", start: 5, end: 10 },
    { text: "Short", start: 10, end: 15 },
  ];

  const mockScenes: VisualScene[] = [
    { start: 0, end: 3, significance: 0.8 },
    { start: 3, end: 7, significance: 0.6 },
    { start: 7, end: 15, significance: 0.9 },
  ];

  describe("scoreClips", () => {
    it("should score with textual content type preference", () => {
      const moments = scoreClips(mockSegments, mockScenes, "textual", 15);

      expect(Array.isArray(moments)).toBe(true);
      expect(moments.length).toBeGreaterThan(0);

      // Each moment should have the required fields
      moments.forEach((moment) => {
        expect(moment).toHaveProperty("start");
        expect(moment).toHaveProperty("end");
        expect(moment).toHaveProperty("textScore");
        expect(moment).toHaveProperty("visualScore");
        expect(moment).toHaveProperty("combinedScore");
        expect(moment.textScore).toBeGreaterThanOrEqual(0);
        expect(moment.textScore).toBeLessThanOrEqual(1);
        expect(moment.visualScore).toBeGreaterThanOrEqual(0);
        expect(moment.visualScore).toBeLessThanOrEqual(1);
        expect(moment.combinedScore).toBeGreaterThanOrEqual(0);
        expect(moment.combinedScore).toBeLessThanOrEqual(1);
      });
    });

    it("should score with visual content type preference", () => {
      const moments = scoreClips(mockSegments, mockScenes, "visual", 15);
      expect(Array.isArray(moments)).toBe(true);
    });

    it("should handle empty segments (visual-only)", () => {
      const moments = scoreClips([], mockScenes, "visual", 15);
      expect(Array.isArray(moments)).toBe(true);
    });

    it("should handle empty scenes (text-only)", () => {
      const moments = scoreClips(mockSegments, [], "textual", 15);
      expect(Array.isArray(moments)).toBe(true);
    });

    it("should return empty moments when both inputs are empty", () => {
      const moments = scoreClips([], [], "textual", 15);
      expect(moments).toEqual([]);
    });

    it("should sort moments by combined score descending", () => {
      const moments = scoreClips(mockSegments, mockScenes, "textual", 15);

      for (let i = 1; i < moments.length; i++) {
        expect(moments[i - 1]!.combinedScore).toBeGreaterThanOrEqual(
          moments[i]!.combinedScore
        );
      }
    });

    it("should produce differentiated scores (not all identical)", () => {
      const moments = scoreClips(mockSegments, mockScenes, "textual", 15);
      // The whole point of Fix 2: scores must NOT all be the same
      const uniqueScores = new Set(moments.map((m) => m.combinedScore));
      expect(uniqueScores.size).toBeGreaterThan(1);
    });

    it("should apply correct weights for textual preference", () => {
      const moments = scoreClips(mockSegments, mockScenes, "textual", 15);
      moments.forEach((moment) => {
        expect(moment.combinedScore).toBeGreaterThanOrEqual(0);
        expect(moment.combinedScore).toBeLessThanOrEqual(1);
      });
    });

    it("should apply correct weights for visual preference", () => {
      const moments = scoreClips(mockSegments, mockScenes, "visual", 15);
      moments.forEach((moment) => {
        expect(moment.combinedScore).toBeGreaterThanOrEqual(0);
        expect(moment.combinedScore).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("createUnifiedMoments", () => {
    it("should merge segment and scene boundaries", () => {
      const moments = createUnifiedMoments(mockSegments, mockScenes, 15);
      expect(moments.length).toBeGreaterThan(0);
      // First moment should start at 0
      expect(moments[0]!.start).toBe(0);
      // Last moment should end at videoDuration
      expect(moments[moments.length - 1]!.end).toBe(15);
    });

    it("should use segments as primary moments (not micro-fragment)", () => {
      const moments = createUnifiedMoments(mockSegments, mockScenes, 15);
      // With 3 contiguous segments covering 0-15, we should get exactly 3 moments
      // (no micro-fragmentation at scene boundaries within segments)
      expect(moments.length).toBe(3);
      expect(moments[0]).toEqual({ start: 0, end: 5 });
      expect(moments[1]).toEqual({ start: 5, end: 10 });
      expect(moments[2]).toEqual({ start: 10, end: 15 });
    });

    it("should fill gaps with scene-based intervals", () => {
      const gappySegments: TranscriptionSegment[] = [
        { text: "First segment", start: 2, end: 5 },
        { text: "Second segment", start: 10, end: 13 },
      ];
      const scenes: VisualScene[] = [
        { start: 0, end: 7, significance: 0.5 },
        { start: 7, end: 15, significance: 0.8 },
      ];
      const moments = createUnifiedMoments(gappySegments, scenes, 15);
      // Should have: gap [0,2], seg [2,5], gap [5,10] split by scene at 7, seg [10,13], gap [13,15]
      expect(moments.length).toBeGreaterThan(2);
      expect(moments[0]!.start).toBe(0);
      expect(moments[moments.length - 1]!.end).toBe(15);
    });
  });

  describe("calculateTextScore", () => {
    it("should return 0 for non-overlapping moment", () => {
      const score = calculateTextScore({ start: 20, end: 25 }, mockSegments);
      expect(score).toBe(0);
    });

    it("should return positive score for overlapping moment", () => {
      const score = calculateTextScore({ start: 0, end: 5 }, mockSegments);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("calculateVisualScore", () => {
    it("should return 0 for non-overlapping moment", () => {
      const score = calculateVisualScore({ start: 20, end: 25 }, mockScenes);
      expect(score).toBe(0);
    });

    it("should return positive score for overlapping moment", () => {
      const score = calculateVisualScore({ start: 0, end: 3 }, mockScenes);
      expect(score).toBeGreaterThan(0);
    });
  });
});
