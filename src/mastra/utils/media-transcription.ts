import OpenAI from "openai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { extractAudio, hasVideoStream, splitAudio } from "./ffmpeg";

export interface TranscribedWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscribedSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscribeMediaInput {
  sourcePath: string;
  language?: string;
  prompt?: string;
  chunkDurationSeconds?: number;
  apiKey?: string;
}

export interface TranscribeMediaResult {
  words: TranscribedWord[];
  segments: TranscribedSegment[];
  fullText: string;
  language: string;
  chunksProcessed: number;
  isVideoInput: boolean;
}

const DEFAULT_CHUNK_DURATION_SECONDS = 600;

export async function transcribeMediaWithWordTimestamps(
  input: TranscribeMediaInput,
): Promise<TranscribeMediaResult> {
  const {
    sourcePath,
    language,
    prompt,
    chunkDurationSeconds = DEFAULT_CHUNK_DURATION_SECONDS,
    apiKey = process.env.OPENAI_API_KEY,
  } = input;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`);
  }

  const openai = new OpenAI({ apiKey });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mastra-transcribe-"));
  let audioPath = sourcePath;
  let isVideoInput = false;

  try {
    isVideoInput = await hasVideoStream(sourcePath);

    if (isVideoInput) {
      const ext = path.extname(sourcePath);
      const base = path.basename(sourcePath, ext);
      audioPath = path.join(tempDir, `${base}_audio.mp3`);
      await extractAudio(sourcePath, audioPath);
    }

    const chunkPaths = await splitAudio(audioPath, tempDir, chunkDurationSeconds);
    const allWords: TranscribedWord[] = [];
    const allSegments: TranscribedSegment[] = [];
    let detectedLanguage = language ?? "";

    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i]!;
      const timeOffset = i * chunkDurationSeconds;
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(chunkPath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word", "segment"],
        ...(language ? { language } : {}),
        ...(prompt ? { prompt } : {}),
      });

      if (i === 0 && transcription.language) {
        detectedLanguage = transcription.language;
      }

      if (transcription.words) {
        for (const word of transcription.words) {
          allWords.push({
            word: word.word,
            start: parseFloat((word.start + timeOffset).toFixed(3)),
            end: parseFloat((word.end + timeOffset).toFixed(3)),
          });
        }
      }

      if (transcription.segments) {
        for (const segment of transcription.segments) {
          allSegments.push({
            text: segment.text,
            start: parseFloat((segment.start + timeOffset).toFixed(3)),
            end: parseFloat((segment.end + timeOffset).toFixed(3)),
          });
        }
      }
    }

    const fullText = allSegments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ");

    return {
      words: allWords,
      segments: allSegments,
      fullText,
      language: detectedLanguage,
      chunksProcessed: chunkPaths.length,
      isVideoInput,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors for temporary artifacts.
    }
  }
}
