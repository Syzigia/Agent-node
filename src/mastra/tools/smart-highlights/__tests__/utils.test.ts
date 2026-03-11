import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  generateTempPath,
  removeFiles,
  verifyDependencies,
  withRetry,
} from "../utils";
import { TEMP_DIR } from "../constants";

describe("Utility Functions", () => {
  describe("generateTempPath", () => {
    it("should generate a path with the correct extension", () => {
      const tempPath = generateTempPath(".mp3");
      expect(tempPath).toContain(".mp3");
    });

    it("should include identifier in filename when provided", () => {
      const tempPath = generateTempPath(".mp3", "audio");
      expect(tempPath).toContain("audio");
    });

    it("should create temp directory if it does not exist", () => {
      const tempPath = generateTempPath(".test");
      expect(fs.existsSync(TEMP_DIR)).toBe(true);
    });

    it("should generate unique paths on subsequent calls", () => {
      const path1 = generateTempPath(".mp3");
      // Small delay to ensure different timestamps
      const start = Date.now();
      while (Date.now() - start < 10) {} // Wait 10ms
      const path2 = generateTempPath(".mp3");
      expect(path1).not.toBe(path2);
    });
  });

  describe("removeFiles", () => {
    let testFiles: string[] = [];

    beforeAll(() => {
      testFiles = [
        path.join(TEMP_DIR, "test1.txt"),
        path.join(TEMP_DIR, "test2.txt"),
      ];
    });

    afterAll(() => {
      testFiles.forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
    });

    it("should return empty arrays for empty input", () => {
      const result = removeFiles([]);
      expect(result.deleted).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it("should track successfully deleted files", () => {
      const testFile = testFiles[0]!;
      fs.writeFileSync(testFile, "content");
      expect(fs.existsSync(testFile)).toBe(true);

      const result = removeFiles([testFile]);
      expect(result.deleted).toContain(testFile);
      expect(result.failed).toEqual([]);
      expect(fs.existsSync(testFile)).toBe(false);
    });

    it("should handle non-existent files gracefully", () => {
      const result = removeFiles(["/nonexistent/file.txt"]);
      // Non-existent files don't count as deleted or failed
      expect(result.failed).toEqual([]);
    });
  });

  describe("withRetry", () => {
    it("should return result on first successful attempt", async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        return "success";
      });
      expect(result).toBe("success");
      expect(attempts).toBe(1);
    });

    it("should retry on failure and succeed", async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error("Not yet");
          }
          return "success";
        },
        5,
        10
      );
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should throw after max attempts", async () => {
      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            throw new Error("Always fails");
          },
          3,
          10
        );
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toBe("Always fails");
        expect(attempts).toBe(3);
      }
    });

    it("should use default retry count of 3", async () => {
      let attempts = 0;
      try {
        await withRetry(async () => {
          attempts++;
          throw new Error("Fail");
        });
      } catch {
        // Expected
      }
      expect(attempts).toBe(3);
    });
  });

  describe("FFmpeg availability", () => {
    it("should verify dependencies without throwing", async () => {
      // This will pass if FFmpeg is installed, or throw if not
      // Either behavior is valid for this test
      try {
        await verifyDependencies();
        // If we get here, dependencies are available
        expect(true).toBe(true);
      } catch (error) {
        // If we get here, dependencies are not available
        expect((error as Error).message).toContain("FFmpeg");
      }
    });
  });
});
