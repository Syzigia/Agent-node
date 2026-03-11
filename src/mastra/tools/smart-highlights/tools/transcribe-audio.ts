import * as fs from "fs";
import FormData from "form-data";
import axios from "axios";
import { type TranscriptionSegment } from "../types";
import {
  RETRY_ATTEMPTS,
  RETRY_DELAY_MS,
} from "../constants";
import { withRetry } from "../utils";

/**
 * Transcribe a single audio chunk using OpenAI Whisper API
 * @param apiKey - OpenAI API key
 * @param chunkPath - Path to audio chunk
 * @param timeOffset - Time offset to add to all timestamps (in seconds)
 * @returns Array of transcription segments
 */
export async function transcribeChunk(
  apiKey: string,
  chunkPath: string,
  timeOffset: number
): Promise<TranscriptionSegment[]> {
  return withRetry(
    async () => {
      console.log(`[transcribeChunk] Transcribing chunk at offset ${timeOffset}s`);

      const formData = new FormData();
      formData.append("file", fs.createReadStream(chunkPath));
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      const response = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            "Authorization": `Bearer ${apiKey}`,
          },
          timeout: 300000, // 5 minute timeout
        }
      );

      const transcription = response.data;

      if (!transcription.segments || !Array.isArray(transcription.segments)) {
        return [];
      }

      const segments: TranscriptionSegment[] = transcription.segments.map((seg: any) => ({
        text: seg.text || "",
        start: parseFloat(((seg.start || 0) + timeOffset).toFixed(3)),
        end: parseFloat(((seg.end || 0) + timeOffset).toFixed(3)),
      }));

      console.log(`[transcribeChunk] Got ${segments.length} segments`);
      return segments;
    },
    RETRY_ATTEMPTS,
    RETRY_DELAY_MS
  );
}
