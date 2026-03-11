import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { TEMP_DIR } from "../constants";
import { generateSingleClip } from "../tools/generate-clips";
import { cleanupFiles } from "../tools/cleanup";

describe("generateSingleClip", () => {
  const testVideoPath = path.join(TEMP_DIR, "test-video.mp4");
  const outputFolder = path.join(TEMP_DIR, "test-output");

  beforeAll(async () => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testVideoPath)) {
      fs.unlinkSync(testVideoPath);
    }
    if (fs.existsSync(outputFolder)) {
      fs.rmSync(outputFolder, { recursive: true, force: true });
    }
  });

  describe("Error Handling", () => {
    it("should reject for non-existent video file", async () => {
      try {
        await generateSingleClip(
          "/nonexistent/video.mp4",
          "/output/clip_001.mp4",
          0,
          5
        );
        expect(false).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});

describe("cleanupFiles", () => {
  const testFiles: string[] = [];

  beforeAll(async () => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    testFiles.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  describe("Cleanup Execution", () => {
    it("should return success for empty file list", () => {
      const result = cleanupFiles([]);

      expect(result.success).toBe(true);
      expect(result.deletedFiles).toEqual([]);
      expect(result.failedFiles).toEqual([]);
    });

    it("should delete existing files", () => {
      const testFile = path.join(TEMP_DIR, "cleanup-test.txt");
      fs.writeFileSync(testFile, "test content");
      testFiles.push(testFile);

      expect(fs.existsSync(testFile)).toBe(true);

      const result = cleanupFiles([testFile]);

      expect(result.success).toBe(true);
      expect(result.deletedFiles).toContain(testFile);
      expect(result.failedFiles).toEqual([]);
      expect(fs.existsSync(testFile)).toBe(false);
    });

    it("should handle non-existent files gracefully", () => {
      const nonExistentFile = "/path/to/nonexistent/file.txt";

      const result = cleanupFiles([nonExistentFile]);

      expect(result.success).toBe(true);
    });

    it("should continue cleanup even if some files fail", () => {
      const existingFile = path.join(TEMP_DIR, "cleanup-existing.txt");
      fs.writeFileSync(existingFile, "content");
      testFiles.push(existingFile);

      const result = cleanupFiles([existingFile, "/root/protected/file.txt"]);

      expect(result.deletedFiles.length).toBeGreaterThanOrEqual(0);
      expect(fs.existsSync(existingFile)).toBe(false);
    });
  });
});
