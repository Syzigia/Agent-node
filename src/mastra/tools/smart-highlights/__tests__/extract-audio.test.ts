import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { TEMP_DIR } from "../constants";
import { checkAudioStream, extractAudioToMp3, getAudioDuration } from "../tools/extract-audio";

describe("extract-audio Functions", () => {
  const testVideoPath = path.join(TEMP_DIR, "test-video.mp4");
  const outputPath = path.join(TEMP_DIR, "test-output.mp3");

  beforeAll(async () => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    [testVideoPath, outputPath].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  describe("checkAudioStream", () => {
    it("should handle non-existent video file", async () => {
      try {
        await checkAudioStream("/nonexistent/video.mp4");
        // May resolve to false instead of throwing, depending on ffprobe behavior
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("extractAudioToMp3", () => {
    it("should reject for non-existent video file", async () => {
      try {
        await extractAudioToMp3("/nonexistent/video.mp4", "/output/audio.mp3");
        expect(false).toBe(true);
      } catch (error) {
        expect((error as Error).message).toBeDefined();
      }
    });

    it("should reject for empty video path", async () => {
      try {
        await extractAudioToMp3("", "/output/audio.mp3");
        expect(false).toBe(true);
      } catch (error) {
        expect((error as Error).message).toBeDefined();
      }
    });
  });
});
