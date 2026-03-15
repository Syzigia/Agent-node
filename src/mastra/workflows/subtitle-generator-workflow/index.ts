import { createWorkflow } from "@mastra/core/workflows";
import z from "zod";

import {
  burnSubtitlesStep,
  hexColorSchema,
  safeAreaBottomPercentSchema,
  subtitleBurnApprovalStep,
  subtitleStylePresetSchema,
} from "./apply-subtitles-steps";
import {
  subtitleAnimationPresetSchema,
  subtitleLayoutModeSchema,
  subtitleTextCaseSchema,
} from "./tiktok-ass";
import { generateAssStep } from "./generate-ass-step";
import { transcribeStep } from "./transcribe-step";

export const subtitleGeneratorWorkflow = createWorkflow({
  id: "subtitle-generator-workflow",
  description:
    "Transcribes a video or audio file using Whisper and returns word-level and segment-level timestamps. Word timestamps enable karaoke-style subtitle sync; segments provide readable phrase blocks for subtitle lines.",
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
        "Optional hint text to guide Whisper with technical vocabulary, proper nouns, or context",
      ),
  }),
  outputSchema: z.object({
    words: z
      .array(
        z.object({
          word: z.string(),
          start: z.number(),
          end: z.number(),
        }),
      )
      .describe("Word-level timestamps from Whisper"),
    segments: z
      .array(
        z.object({
          text: z.string(),
          start: z.number(),
          end: z.number(),
        }),
      )
      .describe("Phrase-level segments from Whisper"),
    fullText: z.string().describe("Complete transcription text"),
    language: z.string().describe("Detected or provided language code"),
    chunksProcessed: z.number().describe("Number of audio chunks processed"),
    assPath: z.string().describe("Relative path to the generated .ass subtitle file"),
    assLines: z.number().describe("Number of subtitle lines written to the .ass file"),
    sourceFilePath: z.string().describe("Original source file path inside workspace"),
    isVideoInput: z.boolean().describe("Whether source media has a video stream"),
    burnApplied: z.boolean().describe("Whether subtitles were burned into a new video"),
    subtitledVideoPath: z
      .string()
      .optional()
      .describe("Relative path to the subtitled video when burnApplied is true"),
    styledAssPath: z
      .string()
      .optional()
      .describe("Relative path to the stylized .ass file used for burn-in"),
    burnMessage: z.string().describe("Human-readable message about burn step result"),
    styleUsed: z
      .object({
        preset: subtitleStylePresetSchema,
        baseColor: hexColorSchema,
        highlightColor: hexColorSchema,
        textCase: subtitleTextCaseSchema,
        layoutMode: subtitleLayoutModeSchema,
        animationPreset: subtitleAnimationPresetSchema,
        safeAreaBottomPercent: safeAreaBottomPercentSchema,
      })
      .optional()
      .describe("Applied subtitle style settings when burnApplied is true"),
  }),
})
  .then(transcribeStep)
  .then(generateAssStep)
  .then(subtitleBurnApprovalStep)
  .then(burnSubtitlesStep)
  .commit();
