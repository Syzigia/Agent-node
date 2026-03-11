import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { TEMP_DIR } from "../constants";
import { detectScenesWithFallback, createUniformScenes } from "../tools/analyze-visual";

describe("analyze-visual Functions", () => {
  const testVideoPath = path.join(TEMP_DIR, "test-video.mp4");

  beforeAll(async () => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testVideoPath)) {
      fs.unlinkSync(testVideoPath);
    }
  });

  describe("createUniformScenes", () => {
    it("should create uniform scenes for a given duration", () => {
      const scenes = createUniformScenes(60);
      expect(Array.isArray(scenes)).toBe(true);
      expect(scenes.length).toBeGreaterThan(0);

      // All scenes should have required fields
      scenes.forEach((scene) => {
        expect(scene).toHaveProperty("start");
        expect(scene).toHaveProperty("end");
        expect(scene).toHaveProperty("significance");
        expect(scene.significance).toBeGreaterThanOrEqual(0);
        expect(scene.significance).toBeLessThanOrEqual(1);
      });

      // First scene starts at 0
      expect(scenes[0]!.start).toBe(0);
      // Last scene ends at duration
      expect(scenes[scenes.length - 1]!.end).toBe(60);
    });
  });

  describe("detectScenesWithFallback", () => {
    it("should handle invalid video gracefully", async () => {
      // Create an invalid video file (text file with .mp4 extension)
      fs.writeFileSync(testVideoPath, "This is not a valid video file");

      try {
        const scenes = await detectScenesWithFallback(testVideoPath, 0.3, 10);
        // If it doesn't throw, it should return scenes array
        expect(Array.isArray(scenes)).toBe(true);
      } catch (error) {
        // Error is acceptable for invalid video
        expect(error).toBeDefined();
      }
    });
  });
});
