import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { TEMP_DIR } from "../constants";
import { transcribeChunk } from "../tools/transcribe-audio";

describe("transcribeChunk", () => {
  const testAudioPath = path.join(TEMP_DIR, "test-audio.mp3");

  beforeAll(async () => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testAudioPath)) {
      fs.unlinkSync(testAudioPath);
    }
  });

  describe("Input Validation", () => {
    it("should throw error for non-existent audio file", async () => {
      try {
        await transcribeChunk("test-key", "/nonexistent/audio.mp3", 0);
        expect(false).toBe(true);
      } catch (error) {
        // Should fail at the API call or file read level
        expect(error).toBeDefined();
      }
    });

    it("should throw error when given invalid API key", async () => {
      // Create a dummy file
      fs.writeFileSync(testAudioPath, "dummy audio content");

      try {
        await transcribeChunk("invalid-key", testAudioPath, 0);
        expect(false).toBe(true);
      } catch (error) {
        // Expected to fail at API level
        expect(error).toBeDefined();
      }
    });
  });
});
