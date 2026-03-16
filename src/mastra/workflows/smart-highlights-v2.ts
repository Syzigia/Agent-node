import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { Mastra } from "@mastra/core";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

import {
  DEFAULT_APPROX_TARGET_DURATION,
  DEFAULT_NUMBER_OF_CLIPS,
  DEFAULT_OUTPUT_FOLDER,
  MAX_CLIPS,
  MAX_TARGET_DURATION_SECONDS,
  MIN_CLIPS,
  MIN_TARGET_DURATION_SECONDS,
} from "../tools/smart-highlights-v2/constants";
import {
  type AnalysisWindow,
  analysisWindowSchema,
  failedClipSchema,
  generatedClipSchema,
  multimodalAssessmentSchema,
  proposedClipSchema,
  sampledFrameSchema,
  sceneBoundarySchema,
  transcriptionSegmentSchema,
  transcriptionWordSchema,
} from "../tools/smart-highlights-v2/types";
import {
  detectSceneBoundaries,
  evaluateCopySafety,
  extractKeyframes,
  prepareAudioArtifact,
  readMediaMetadata,
  sampleFrames,
  writeClipFile,
} from "../tools/smart-highlights-v2/media";
import { buildAnalysisWindows, buildProposedClips, selectPreviewWindows } from "../tools/smart-highlights-v2/selection";
import { generateTempArtifactPath, removeArtifacts } from "../tools/smart-highlights-v2/artifacts";
import { transcribeMediaWithWordTimestamps } from "../utils/media-transcription";
import { resolveWorkspaceMediaPath, WORKSPACE_PATH, sanitizePath } from "../workspace";

const workflowInputSchema = z.object({
  file: z.string().describe("Relative path to the source video in the workspace"),
});

const configResumeSchema = z.object({
  numberOfClips: z.number().min(MIN_CLIPS).max(MAX_CLIPS),
  targetDurationApprox: z.number().min(MIN_TARGET_DURATION_SECONDS).max(MAX_TARGET_DURATION_SECONDS),
  outputFolder: z.string(),
});

const configOutputSchema = z.object({
  file: z.string(),
  numberOfClips: z.number(),
  targetDurationApprox: z.number(),
  outputFolder: z.string(),
  startedAt: z.number(),
});

const preparedOutputSchema = configOutputSchema.extend({
  videoPath: z.string(),
  audioPath: z.string(),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  hasAudio: z.boolean(),
  tempArtifacts: z.array(z.string()),
  framesDir: z.string(),
});

const analyzedOutputSchema = preparedOutputSchema.extend({
  words: z.array(transcriptionWordSchema),
  segments: z.array(transcriptionSegmentSchema),
  scenes: z.array(sceneBoundarySchema),
  keyframes: z.array(z.number()),
  frames: z.array(sampledFrameSchema),
  windows: z.array(analysisWindowSchema),
});

const assessedWindowSchema = analysisWindowSchema.extend({
  assessment: multimodalAssessmentSchema.optional(),
});

const assessedOutputSchema = analyzedOutputSchema.extend({
  rankedWindows: z.array(assessedWindowSchema),
  proposedClips: z.array(proposedClipSchema),
});

const finalOutputSchema = z.object({
  success: z.boolean(),
  outputFolder: z.string(),
  clipsGenerated: z.number(),
  clips: z.array(generatedClipSchema),
  failedClips: z.array(failedClipSchema),
  originalVideo: z.string(),
  processingTime: z.number(),
  selectedClips: z.array(proposedClipSchema),
  cleanupReport: z.object({
    success: z.boolean(),
    deletedFiles: z.array(z.string()),
    failedFiles: z.array(z.object({ path: z.string(), error: z.string() })),
  }),
});

const configStep = createStep({
  id: "v2-config-step",
  description: "Collect approximate clip preferences",
  inputSchema: workflowInputSchema,
  suspendSchema: z.object({
    message: z.string(),
    file: z.string(),
    defaultValues: z.object({
      numberOfClips: z.number(),
      targetDurationApprox: z.number(),
      outputFolder: z.string(),
    }),
  }),
  resumeSchema: configResumeSchema,
  outputSchema: configOutputSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { resolvedPath: file } = resolveWorkspaceMediaPath(inputData.file);

    if (!resumeData) {
      return suspend({
        message:
          "How many clips do you want, and what approximate duration should each clip target? Durations are flexible and the workflow will return the maximum good clips available.",
        file,
        defaultValues: {
          numberOfClips: DEFAULT_NUMBER_OF_CLIPS,
          targetDurationApprox: DEFAULT_APPROX_TARGET_DURATION,
          outputFolder: DEFAULT_OUTPUT_FOLDER,
        },
      });
    }

    return {
      file,
      numberOfClips: resumeData.numberOfClips,
      targetDurationApprox: resumeData.targetDurationApprox,
      outputFolder: sanitizePath(resumeData.outputFolder),
      startedAt: Date.now(),
    };
  },
});

const prepareStep = createStep({
  id: "v2-prepare-media",
  description: "Prepare audio artifact and read media metadata",
  inputSchema: configOutputSchema,
  outputSchema: preparedOutputSchema,
  execute: async ({ inputData }) => {
    const videoPath = path.join(WORKSPACE_PATH, inputData.file);
    const audioPath = generateTempArtifactPath(".mp3", "highlights-v2-audio");
    const framesDir = generateTempArtifactPath("", "highlights-v2-frames");
    fs.mkdirSync(framesDir, { recursive: true });

    const metadata = await readMediaMetadata(videoPath);
    if (metadata.hasAudio) {
      await prepareAudioArtifact(videoPath, audioPath);
    }

    return {
      ...inputData,
      videoPath,
      audioPath,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      hasAudio: metadata.hasAudio,
      tempArtifacts: metadata.hasAudio ? [audioPath, framesDir] : [framesDir],
      framesDir,
    };
  },
});

const analyzeStep = createStep({
  id: "v2-analyze-media",
  description: "Transcribe, detect scenes, keyframes, and sample frames",
  inputSchema: preparedOutputSchema,
  outputSchema: analyzedOutputSchema,
  execute: async ({ inputData }) => {
    const [transcription, scenes, keyframes, frames] = await Promise.all([
      inputData.hasAudio
        ? transcribeMediaWithWordTimestamps({ sourcePath: inputData.audioPath })
        : Promise.resolve({
            words: [],
            segments: [],
            fullText: "",
            language: "",
            chunksProcessed: 0,
            isVideoInput: true,
          }),
      detectSceneBoundaries(inputData.videoPath, inputData.duration),
      extractKeyframes(inputData.videoPath),
      sampleFrames(inputData.videoPath, inputData.framesDir, inputData.duration),
    ]);

    const windows = buildAnalysisWindows({
      duration: inputData.duration,
      words: transcription.words,
      segments: transcription.segments,
      scenes,
      frames,
      keyframes,
      targetDuration: inputData.targetDurationApprox,
    });

    return {
      ...inputData,
      words: transcription.words,
      segments: transcription.segments,
      scenes,
      keyframes,
      frames,
      windows,
    };
  },
});

async function assessWindow(
  mastraInstance: Mastra,
  window: AnalysisWindow,
): Promise<z.infer<typeof multimodalAssessmentSchema>> {
  const clipSelectorAgent = mastraInstance.getAgent("clipSelectorMultimodalAgent");
  const frameParts = window.frames.map((frame) => ({
    type: "image" as const,
    image: fs.readFileSync(frame.path),
    mimeType: "image/jpeg",
  }));

  try {
    const response = await clipSelectorAgent.generate([
      {
        role: "user",
        content: [
          ...frameParts,
          {
            type: "text" as const,
            text: JSON.stringify({
              instruction:
                "Evaluate if this candidate video window should become a standalone clip. Use both transcript and images.",
              window: {
                id: window.id,
                start: window.start,
                end: window.end,
                transcript: window.transcript,
                wordCount: window.wordCount,
                sceneCount: window.sceneCount,
                keyframeCount: window.keyframeCount,
                heuristicScore: window.heuristicScore,
                emphasisSignals: window.emphasisSignals,
                frameTimestamps: window.frames.map((frame) => frame.timestamp),
              },
            }),
          },
        ],
      },
    ], {
      structuredOutput: { schema: multimodalAssessmentSchema },
    });

    return multimodalAssessmentSchema.parse(response.object);
  } catch (error) {
    const fallbackScore = Math.min(1, Math.max(0.2, window.heuristicScore));
    return {
      score: fallbackScore,
      hookStrength: Math.min(1, fallbackScore + 0.05),
      semanticImportance: Math.min(1, fallbackScore),
      visualEnergy: Math.min(1, window.sceneCount / 3 + window.frames.length / 10),
      startOffsetSeconds: 0.5,
      endOffsetSeconds: 1,
      keepWindowWhole: false,
      reason: `Fallback heuristic assessment: ${error instanceof Error ? error.message : String(error)}`,
      textSignals: window.emphasisSignals,
      visualSignals: [`${window.sceneCount} scene cues`, `${window.frames.length} sampled frames`],
    };
  }
}

const selectionStep = createStep({
  id: "v2-select-clips",
  description: "Rank candidate windows and build clip proposals",
  inputSchema: analyzedOutputSchema,
  outputSchema: assessedOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const previewWindows = selectPreviewWindows(inputData.windows);

    if (!mastra) {
      throw new Error("Mastra instance not available in v2-select-clips step");
    }

    const rankedWindows = await Promise.all(
      previewWindows.map(async (window) => ({
        ...window,
        assessment: await assessWindow(mastra, window),
      })),
    );

    const proposedClips = buildProposedClips({
      rankedWindows: rankedWindows.sort(
        (a, b) => (b.assessment?.score ?? b.heuristicScore) - (a.assessment?.score ?? a.heuristicScore),
      ),
      targetDuration: inputData.targetDurationApprox,
      numberOfClips: inputData.numberOfClips,
      words: inputData.words,
      scenes: inputData.scenes,
      keyframes: inputData.keyframes,
      duration: inputData.duration,
    });

    return {
      ...inputData,
      rankedWindows,
      proposedClips,
    };
  },
});

const approvalStep = createStep({
  id: "v2-approval-step",
  description: "Pause for user approval of clip proposals",
  inputSchema: assessedOutputSchema,
  suspendSchema: z.object({
    message: z.string(),
    proposedClips: z.array(proposedClipSchema),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    modifiedClips: z
      .array(
        z.object({
          start: z.number(),
          end: z.number(),
        }),
      )
      .optional(),
  }),
  outputSchema: assessedOutputSchema.extend({
    selectedClips: z.array(proposedClipSchema),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({
        message: "Review the proposed clips. They default to copy-if-safe and will fall back to re-encode when needed.",
        proposedClips: inputData.proposedClips,
      });
    }

    if (!resumeData.approved) {
      throw new Error("User cancelled smart-highlights-v2 generation");
    }

    const selectedClips = resumeData.modifiedClips?.length
      ? resumeData.modifiedClips.map((clip, index) => {
          const original = inputData.proposedClips[index] ?? inputData.proposedClips[0]!;
          const copyEvaluation = evaluateCopySafety(clip.start, clip.end, inputData.keyframes);
          const strategy: "stream-copy" | "reencode" = copyEvaluation.copySafe ? "stream-copy" : "reencode";
          return {
            ...original,
            start: clip.start,
            end: clip.end,
            copySafe: copyEvaluation.copySafe,
            copyStart: copyEvaluation.copyStart,
            copyEnd: copyEvaluation.copyEnd,
            strategy,
          };
        })
      : inputData.proposedClips;

    return {
      ...inputData,
      selectedClips,
    };
  },
});

const generateStep = createStep({
  id: "v2-generate-clips",
  description: "Generate highlight clips using copy-if-safe",
  inputSchema: assessedOutputSchema.extend({
    selectedClips: z.array(proposedClipSchema),
  }),
  outputSchema: finalOutputSchema.extend({
    tempArtifacts: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const outputFolderPath = path.join(WORKSPACE_PATH, inputData.outputFolder);
    fs.mkdirSync(outputFolderPath, { recursive: true });

    const clips: Array<z.infer<typeof generatedClipSchema>> = [];
    const failedClips: Array<z.infer<typeof failedClipSchema>> = [];

    for (let index = 0; index < inputData.selectedClips.length; index++) {
      const clip = inputData.selectedClips[index]!;
      const filename = `clip_${String(index + 1).padStart(3, "0")}.mp4`;
      const outputPath = path.join(outputFolderPath, filename);

      try {
        await writeClipFile(inputData.videoPath, outputPath, clip);
        clips.push({
          filename,
          path: outputPath,
          duration: parseFloat((clip.end - clip.start).toFixed(3)),
          strategy: clip.strategy,
        });
      } catch (error) {
        failedClips.push({
          start: clip.start,
          end: clip.end,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: clips.length > 0,
      outputFolder: inputData.outputFolder,
      clipsGenerated: clips.length,
      clips,
      failedClips,
      originalVideo: inputData.file,
      processingTime: Math.round((Date.now() - inputData.startedAt) / 1000),
      selectedClips: inputData.selectedClips,
      cleanupReport: {
        success: true,
        deletedFiles: [],
        failedFiles: [],
      },
      tempArtifacts: inputData.tempArtifacts,
    };
  },
});

const cleanupStep = createStep({
  id: "v2-cleanup",
  description: "Cleanup temporary artifacts for smart-highlights-v2",
  inputSchema: finalOutputSchema.extend({
    tempArtifacts: z.array(z.string()),
  }),
  outputSchema: finalOutputSchema,
  execute: async ({ inputData }) => {
    const cleanupResult = removeArtifacts(inputData.tempArtifacts);

    return {
      success: inputData.success,
      outputFolder: inputData.outputFolder,
      clipsGenerated: inputData.clipsGenerated,
      clips: inputData.clips,
      failedClips: inputData.failedClips,
      originalVideo: inputData.originalVideo,
      processingTime: inputData.processingTime,
      selectedClips: inputData.selectedClips,
      cleanupReport: {
        success: cleanupResult.failed.length === 0,
        deletedFiles: cleanupResult.deleted,
        failedFiles: cleanupResult.failed,
      },
    };
  },
});

export const smartHighlightsV2Workflow = createWorkflow({
  id: "smart-highlights-v2",
  description:
    "Generates scene-aware smart highlights with Whisper word timestamps, frame sampling, multimodal ranking, and copy-if-safe clip generation.",
  inputSchema: workflowInputSchema,
  outputSchema: finalOutputSchema,
})
  .then(configStep)
  .then(prepareStep)
  .then(analyzeStep)
  .then(selectionStep)
  .then(approvalStep)
  .then(generateStep)
  .then(cleanupStep)
  .commit();
