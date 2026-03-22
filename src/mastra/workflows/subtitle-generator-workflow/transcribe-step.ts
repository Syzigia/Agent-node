import { createStep } from "@mastra/core/workflows"
import * as path from "path"
import z from "zod"

import { transcribeMediaWithWordTimestamps } from "../../utils/media-transcription"
import { sanitizePath } from "../../workspace"
import {
  getFilesystem,
  createTempWorkspace,
  ensureLocalFile,
  cleanupTempWorkspace,
  resolveS3MediaPath,
} from "../../workspace/context"

// ─── Schemas ──────────────────────────────────────────────────────────────────

const wordSchema = z.object({
  word: z.string().describe("The transcribed word (may have a leading space)"),
  start: z
    .number()
    .describe("Word start time in seconds, relative to the full file"),
  end: z
    .number()
    .describe("Word end time in seconds, relative to the full file"),
})

const segmentSchema = z.object({
  text: z.string().describe("Phrase text for this segment"),
  start: z
    .number()
    .describe("Segment start time in seconds, relative to the full file"),
  end: z
    .number()
    .describe("Segment end time in seconds, relative to the full file"),
})

// ─── Step ─────────────────────────────────────────────────────────────────────

export const transcribeStep = createStep({
  id: "transcribe-step",
  inputSchema: z.object({
    filePath: z
      .string()
      .describe(
        "Relative path to the video or audio file within the workspace"
      ),
    language: z
      .string()
      .optional()
      .describe(
        "ISO-639-1 language code (e.g. 'en', 'es'). Improves accuracy and latency."
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        "Optional hint text to guide Whisper (technical vocabulary, proper nouns, context, etc.)"
      ),
  }),
  outputSchema: z.object({
    words: z.array(wordSchema).describe("Word-level timestamps from Whisper"),
    segments: z
      .array(segmentSchema)
      .describe("Phrase-level segments from Whisper"),
    fullText: z
      .string()
      .describe("Complete transcription text joined from all segments"),
    language: z.string().describe("Detected or provided language code"),
    chunksProcessed: z
      .number()
      .describe("Number of audio chunks sent to Whisper"),
    sourceFilePath: z
      .string()
      .describe("Resolved path of the source file in S3"),
  }),

  execute: async ({ inputData, requestContext }) => {
    const { filePath, language, prompt } = inputData
    const filesystem = getFilesystem({ requestContext })
    const tempDir = createTempWorkspace()

    try {
      // ── 1. Resolve and validate the source path ────────────────────────────
      const relPath = sanitizePath(filePath)
      const { resolvedPath } = await resolveS3MediaPath(filesystem, relPath)
      console.log(`[transcribe-step] Resolved path: ${resolvedPath}`)

      // ── 2. Download from S3 to local temp ─────────────────────────────────
      const { localPath: srcPath } = await ensureLocalFile(
        filesystem,
        resolvedPath,
        tempDir
      )
      console.log(`[transcribe-step] Local path: ${srcPath}`)

      // ── 3. Transcribe ─────────────────────────────────────────────────────
      const result = await transcribeMediaWithWordTimestamps({
        sourcePath: srcPath,
        language,
        prompt,
      })

      console.log(
        `[transcribe-step] Done. ${result.words.length} words, ${result.segments.length} segments.`
      )

      return {
        words: result.words,
        segments: result.segments,
        fullText: result.fullText,
        language: result.language,
        chunksProcessed: result.chunksProcessed,
        sourceFilePath: resolvedPath,
      }
    } finally {
      cleanupTempWorkspace(tempDir)
    }
  },
})
