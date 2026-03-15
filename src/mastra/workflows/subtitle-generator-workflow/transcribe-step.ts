import { createStep } from "@mastra/core/workflows";
import OpenAI from "openai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import z from "zod";

import { extractAudio, hasVideoStream, splitAudio } from "../../utils/ffmpeg";
import { sanitizePath, WORKSPACE_PATH } from "../../workspace";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Each audio chunk sent to Whisper is at most this many seconds long. */
const CHUNK_DURATION_SECONDS = 600; // 10 minutes

// ─── Schemas ──────────────────────────────────────────────────────────────────

const wordSchema = z.object({
  word: z.string().describe("The transcribed word (may have a leading space)"),
  start: z.number().describe("Word start time in seconds, relative to the full file"),
  end: z.number().describe("Word end time in seconds, relative to the full file"),
});

const segmentSchema = z.object({
  text: z.string().describe("Phrase text for this segment"),
  start: z.number().describe("Segment start time in seconds, relative to the full file"),
  end: z.number().describe("Segment end time in seconds, relative to the full file"),
});

// ─── Step ─────────────────────────────────────────────────────────────────────

export const transcribeStep = createStep({
  id: "transcribe-step",
  inputSchema: z.object({
    filePath: z
      .string()
      .describe("Relative path to the video or audio file within the workspace"),
    language: z
      .string()
      .optional()
      .describe("ISO-639-1 language code (e.g. 'en', 'es'). Improves accuracy and latency."),
    prompt: z
      .string()
      .optional()
      .describe(
        "Optional hint text to guide Whisper (technical vocabulary, proper nouns, context, etc.)",
      ),
  }),
  outputSchema: z.object({
    words: z.array(wordSchema).describe("Word-level timestamps from Whisper"),
    segments: z.array(segmentSchema).describe("Phrase-level segments from Whisper"),
    fullText: z.string().describe("Complete transcription text joined from all segments"),
    language: z.string().describe("Detected or provided language code"),
    chunksProcessed: z.number().describe("Number of audio chunks sent to Whisper"),
  }),

  execute: async ({ inputData }) => {
    const { filePath, language, prompt } = inputData;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY environment variable is not set");

    const openai = new OpenAI({ apiKey });

    // ── 1. Resolve and validate the source path ────────────────────────────
    const relPath = sanitizePath(filePath);
    const srcPath = path.join(WORKSPACE_PATH, relPath);

    if (!fs.existsSync(srcPath)) {
      throw new Error(`File not found in workspace: ${relPath}`);
    }

    // ── 2. Create a temp directory for extracted audio and chunk files ─────
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "subtitle-txn-"));
    let audioPath = srcPath;
    let extractedAudioPath: string | null = null;

    try {
      // ── 3. Extract audio track if the source is a video ─────────────────
      const isVideo = await hasVideoStream(srcPath);

      if (isVideo) {
        const ext = path.extname(relPath);
        const base = path.basename(relPath, ext);
        extractedAudioPath = path.join(tempDir, `${base}_audio.mp3`);

        console.log(`[transcribe-step] Video detected — extracting audio to ${extractedAudioPath}`);
        await extractAudio(srcPath, extractedAudioPath);
        audioPath = extractedAudioPath;
      }

      // ── 4. Split audio into fixed-length chunks ──────────────────────────
      // splitAudio returns sorted chunk paths named: <base>_chunk_000.mp3, _001, ...
      // The index of each chunk * CHUNK_DURATION_SECONDS gives its time offset.
      const chunkPaths = await splitAudio(audioPath, tempDir, CHUNK_DURATION_SECONDS);

      console.log(`[transcribe-step] Transcribing ${chunkPaths.length} chunk(s)...`);

      // ── 5. Transcribe each chunk with word + segment granularities ───────
      const allWords: Array<{ word: string; start: number; end: number }> = [];
      const allSegments: Array<{ text: string; start: number; end: number }> = [];
      let detectedLanguage = language ?? "";

      for (let i = 0; i < chunkPaths.length; i++) {
        const chunkPath = chunkPaths[i]!;
        const timeOffset = i * CHUNK_DURATION_SECONDS;

        console.log(
          `[transcribe-step] Chunk ${i + 1}/${chunkPaths.length}, timeOffset=${timeOffset}s`,
        );

        // verbose_json is required for timestamp_granularities to work.
        // Requesting both "word" and "segment" in one call:
        //   - words[]    → individual word timestamps (for karaoke-style sync)
        //   - segments[] → phrase-level blocks (for readable subtitle lines)
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(chunkPath),
          model: "whisper-1",
          response_format: "verbose_json",
          timestamp_granularities: ["word", "segment"],
          ...(language && { language }),
          ...(prompt && { prompt }),
        });

        // Capture the detected language from the first chunk
        if (i === 0 && transcription.language) {
          detectedLanguage = transcription.language;
        }

        // Merge word-level timestamps, applying the chunk time offset
        if (transcription.words) {
          for (const w of transcription.words) {
            allWords.push({
              word: w.word,
              start: parseFloat((w.start + timeOffset).toFixed(3)),
              end: parseFloat((w.end + timeOffset).toFixed(3)),
            });
          }
        }

        // Merge segment-level timestamps, applying the chunk time offset
        if (transcription.segments) {
          for (const s of transcription.segments) {
            allSegments.push({
              text: s.text,
              start: parseFloat((s.start + timeOffset).toFixed(3)),
              end: parseFloat((s.end + timeOffset).toFixed(3)),
            });
          }
        }
      }

      const fullText = allSegments
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(" ");

      console.log(
        `[transcribe-step] Done. ${allWords.length} words, ${allSegments.length} segments.`,
      );

      return {
        words: allWords,
        segments: allSegments,
        fullText,
        language: detectedLanguage,
        chunksProcessed: chunkPaths.length,
      };
    } finally {
      // ── 6. Always clean up temp files, even on error ─────────────────────
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Non-fatal — temp files will be cleaned by the OS eventually
      }
    }
  },
});
