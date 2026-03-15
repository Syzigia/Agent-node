import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { sanitizePath } from "../../../workspace";
import {
  hexColorSchema,
  safeAreaBottomPercentSchema,
  subtitleStylePresetSchema,
} from "../../../workflows/subtitle-generator-workflow/apply-subtitles-steps";
import {
  subtitleAnimationPresetSchema,
  subtitleLayoutModeSchema,
  subtitleTextCaseSchema,
} from "../../../workflows/subtitle-generator-workflow/tiktok-ass";

const wordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

const segmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
});

const subtitleResultSchema = z.object({
  words: z.array(wordSchema),
  segments: z.array(segmentSchema),
  fullText: z.string(),
  language: z.string(),
  chunksProcessed: z.number(),
  assPath: z.string(),
  assLines: z.number(),
  sourceFilePath: z.string(),
  isVideoInput: z.boolean(),
  burnApplied: z.boolean(),
  subtitledVideoPath: z.string().optional(),
  styledAssPath: z.string().optional(),
  burnMessage: z.string(),
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
    .optional(),
});

function extractWorkflowError(result: any): string {
  const topLevelMessage =
    typeof result?.error?.message === "string"
      ? result.error.message
      : typeof result?.error === "string"
        ? result.error
        : "";

  if (topLevelMessage) {
    return topLevelMessage;
  }

  const lastStepId = Array.isArray(result?.stepExecutionPath)
    ? result.stepExecutionPath[result.stepExecutionPath.length - 1]
    : undefined;
  const lastStepError = lastStepId
    ? result?.steps?.[lastStepId]?.error?.message
    : undefined;

  if (typeof lastStepError === "string" && lastStepError.length > 0) {
    return lastStepError;
  }

  return "Workflow failed without a detailed error message.";
}

/**
 * Tool 1: Starts the subtitle generator workflow.
 * Transcribes audio with Whisper and generates an .ass file.
 */
export const startSubtitleGeneratorTool = createTool({
  id: "start-subtitle-generator",
  description: `Transcribes a video or audio file using Whisper and generates an .ass subtitle file.

This tool:
1. Extracts audio if the input is a video
2. Splits audio into chunks
3. Transcribes with word + segment timestamps
4. Generates an .ass file with karaoke-ready timing tags

Supported formats: mp4, mov, avi, mkv, webm, mp3, m4a, wav, ogg, flac`,
  inputSchema: z.object({
    filePath: z.string().describe("Relative path within the workspace (e.g., wild_project.mp4)"),
    language: z
      .string()
      .optional()
      .describe("ISO-639-1 language code (e.g. 'en', 'es'). Improves accuracy and latency."),
    prompt: z
      .string()
      .optional()
      .describe("Optional hint text to guide Whisper with domain-specific vocabulary."),
  }),
  outputSchema: z.object({
    status: z.string(),
    workflowStatus: z.string().optional(),
    runId: z.string(),
    message: z.string(),
    result: subtitleResultSchema.optional(),
    suspendedStep: z.string().optional(),
    suspendPayload: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    console.log("[startSubtitleGeneratorTool] Starting execution...");
    console.log("[startSubtitleGeneratorTool] Input:", JSON.stringify(inputData, null, 2));

    const filePath = sanitizePath(inputData.filePath);
    const { language, prompt } = inputData;
    const { mastra } = context;

    if (!mastra) {
      console.error("[startSubtitleGeneratorTool] ERROR: Mastra instance not available");
      throw new Error("Mastra instance not available in tool context");
    }

    console.log("[startSubtitleGeneratorTool] Getting workflow...");
    const workflow = mastra.getWorkflow("subtitleGeneratorWorkflow");

    if (!workflow) {
      return {
        status: "error",
        runId: "",
        message: "Workflow not found. Verify that subtitleGeneratorWorkflow is registered.",
        error: "subtitleGeneratorWorkflow not found",
      };
    }

    console.log("[startSubtitleGeneratorTool] Creating run...");
    const run = await workflow.createRun();
    console.log("[startSubtitleGeneratorTool] Run created with ID:", run.runId);

    console.log("[startSubtitleGeneratorTool] Executing run.start()...");
    const result = await run.start({
      inputData: {
        filePath,
        ...(language && { language }),
        ...(prompt && { prompt }),
      },
    });
    console.log("[startSubtitleGeneratorTool] Result of run.start():", JSON.stringify(result, null, 2));

    if (result.status === "success") {
      return {
        status: "success",
        runId: run.runId,
        message: "Subtitles generated successfully.",
        result: result.result as z.infer<typeof subtitleResultSchema>,
      };
    }

    if (result.status === "suspended") {
      const suspendedStepKey = result.suspended?.[0]?.[0] ?? "unknown-step";
      const suspendPayload = result.steps?.[suspendedStepKey]?.suspendPayload as any;
      return {
        status: "suspended",
        workflowStatus: result.status,
        runId: run.runId,
        message: "Workflow suspended and awaiting user input.",
        suspendedStep: suspendedStepKey,
        suspendPayload,
      };
    }

    if (result.status === "failed") {
      const errMsg = extractWorkflowError(result);
      const lastStepId = Array.isArray(result.stepExecutionPath)
        ? result.stepExecutionPath[result.stepExecutionPath.length - 1]
        : undefined;
      return {
        status: "error",
        workflowStatus: result.status,
        runId: run.runId,
        message: lastStepId
          ? `Workflow failed at step "${lastStepId}".`
          : "Workflow failed during execution.",
        error: errMsg,
      };
    }

    if (result.status === "tripwire" || result.status === "paused") {
      return {
        status: "error",
        workflowStatus: result.status,
        runId: run.runId,
        message: `Workflow finished with status "${result.status}".`,
        error: `Workflow status ${result.status} is not handled by this tool.`,
      };
    }

    return {
      status: "error",
      workflowStatus: "unknown",
      runId: run.runId,
      message: "Workflow finished with an unexpected status.",
      error: "Unexpected workflow status",
    };
  },
});

/**
 * Tool 2: Resumes the subtitle generator workflow from a suspended step.
 * Useful for future HITL checkpoints.
 */
export const resumeSubtitleGeneratorTool = createTool({
  id: "resume-subtitle-generator",
  description: `Resumes the subtitle generator workflow from a suspended step.

Use this after start-subtitle-generator returns status "suspended".
Provide the step id and resumeData required by that step.`,
  inputSchema: z.object({
    runId: z.string().describe("Run ID returned by start-subtitle-generator"),
    step: z.string().describe("Step id to resume (e.g., 'human-approval')"),
    resumeData: z.record(z.string(), z.unknown()).optional(),
    applyToVideo: z
      .boolean()
      .optional()
      .describe("Convenience field for subtitle-burn-approval step when not nesting inside resumeData."),
    stylePreset: subtitleStylePresetSchema
      .optional()
      .describe("Convenience field for subtitle-burn-approval step."),
    baseColor: hexColorSchema
      .optional()
      .describe("Convenience field for subtitle-burn-approval step (#RRGGBB)."),
    highlightColor: hexColorSchema
      .optional()
      .describe("Convenience field for subtitle-burn-approval step (#RRGGBB)."),
    textCase: subtitleTextCaseSchema
      .optional()
      .describe("Caption casing style for subtitle-burn-approval step."),
    layoutMode: subtitleLayoutModeSchema
      .optional()
      .describe("Caption layout style for subtitle-burn-approval step."),
    animationPreset: subtitleAnimationPresetSchema
      .optional()
      .describe("Caption animation style for subtitle-burn-approval step."),
    safeAreaBottomPercent: safeAreaBottomPercentSchema
      .optional()
      .describe("Bottom safe area percentage for subtitle placement (4-20)."),
  }),
  outputSchema: z.object({
    status: z.string(),
    workflowStatus: z.string().optional(),
    runId: z.string(),
    message: z.string(),
    result: subtitleResultSchema.optional(),
    suspendedStep: z.string().optional(),
    suspendPayload: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    console.log("[resumeSubtitleGeneratorTool] Starting execution...");
    console.log("[resumeSubtitleGeneratorTool] Input:", JSON.stringify(inputData, null, 2));

    const {
      runId,
      step,
      resumeData,
      applyToVideo,
      stylePreset,
      baseColor,
      highlightColor,
      textCase,
      layoutMode,
      animationPreset,
      safeAreaBottomPercent,
    } = inputData;
    const { mastra } = context;

    const normalizedStep = step === "burn-approval" ? "subtitle-burn-approval" : step;

    let effectiveResumeData: Record<string, unknown> = resumeData ?? {};
    if (normalizedStep === "subtitle-burn-approval") {
      effectiveResumeData = {
        ...effectiveResumeData,
        ...(applyToVideo !== undefined && { applyToVideo }),
        ...(stylePreset && { stylePreset }),
        ...(baseColor && { baseColor }),
        ...(highlightColor && { highlightColor }),
        ...(textCase && { textCase }),
        ...(layoutMode && { layoutMode }),
        ...(animationPreset && { animationPreset }),
        ...(safeAreaBottomPercent !== undefined && { safeAreaBottomPercent }),
      };

      if (effectiveResumeData.applyToVideo === undefined) {
        return {
          status: "error",
          workflowStatus: "failed",
          runId,
          message:
            'Missing required value "applyToVideo" for step "subtitle-burn-approval". Pass it inside resumeData or as a top-level input field.',
          error:
            'Invalid resume input. Example: { "runId": "...", "step": "subtitle-burn-approval", "resumeData": { "applyToVideo": true, "stylePreset": "shorts-bold", "baseColor": "#FFFFFF", "highlightColor": "#00E5FF", "textCase": "uppercase", "layoutMode": "two-lines", "animationPreset": "tiktok-pop", "safeAreaBottomPercent": 8 } }',
        };
      }
    }

    if (!mastra) {
      console.error("[resumeSubtitleGeneratorTool] ERROR: Mastra instance not available");
      throw new Error("Mastra instance not available in tool context");
    }

    const workflow = mastra.getWorkflow("subtitleGeneratorWorkflow");
    if (!workflow) {
      return {
        status: "error",
        runId,
        message: "Workflow not found. Verify that subtitleGeneratorWorkflow is registered.",
        error: "subtitleGeneratorWorkflow not found",
      };
    }

    // Optionally verify run state if available
    try {
      const runState = await workflow.getWorkflowRunById(runId);
      if (runState?.status && runState.status !== "suspended") {
        return {
          status: runState.status,
          runId,
          message:
            runState.status === "failed"
              ? `Cannot resume: workflow status is "failed". Start a new run with start-subtitle-generator.`
              : `Cannot resume: workflow status is "${runState.status}", not "suspended".`,
          error: `Run ${runId} is not suspended`,
        };
      }
    } catch (err) {
      console.warn("[resumeSubtitleGeneratorTool] Could not verify run state, proceeding anyway.");
    }

    try {
      const run = await workflow.createRun({ runId });
      const result = await run.resume({
        step: normalizedStep,
        resumeData: effectiveResumeData,
      });

      if (result.status === "success") {
        return {
          status: "success",
          runId,
          message: "Workflow resumed and completed successfully.",
          result: result.result as z.infer<typeof subtitleResultSchema>,
        };
      }

      if (result.status === "suspended") {
        const suspendedStepKey = result.suspended?.[0]?.[0] ?? "unknown-step";
        const suspendPayload = result.steps?.[suspendedStepKey]?.suspendPayload as any;
        return {
          status: "suspended",
          workflowStatus: result.status,
          runId,
          message: "Workflow suspended again and awaiting user input.",
          suspendedStep: suspendedStepKey,
          suspendPayload,
        };
      }

      if (result.status === "failed") {
        const errMsg = extractWorkflowError(result);
        const lastStepId = Array.isArray(result.stepExecutionPath)
          ? result.stepExecutionPath[result.stepExecutionPath.length - 1]
          : undefined;
        return {
          status: "error",
          workflowStatus: result.status,
          runId,
          message: lastStepId
            ? `Workflow failed after resume at step "${lastStepId}".`
            : "Workflow failed after resume.",
          error: errMsg,
        };
      }

      if (result.status === "tripwire" || result.status === "paused") {
        return {
          status: "error",
          workflowStatus: result.status,
          runId,
          message: `Workflow resumed but finished with status "${result.status}".`,
          error: `Workflow status ${result.status} is not handled by this tool.`,
        };
      }

      return {
        status: "error",
        workflowStatus: "unknown",
        runId,
        message: "Workflow finished with an unexpected status after resume.",
        error: "Unexpected workflow status",
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[resumeSubtitleGeneratorTool] Error resuming workflow:", errMsg);

      if (/not suspended/i.test(errMsg)) {
        try {
          const latest = await workflow.getWorkflowRunById(runId);
          const latestStatus = latest?.status ?? "unknown";
          const suspendedStep =
            latestStatus === "suspended"
              ? Object.entries((latest?.steps ?? {}) as Record<string, any>).find(([, stepData]) => stepData?.status === "suspended")?.[0]
              : undefined;

          return {
            status: latestStatus === "suspended" ? "suspended" : "error",
            workflowStatus: latestStatus,
            runId,
            message:
              latestStatus === "suspended"
                ? `Run is suspended${suspendedStep ? ` at step "${suspendedStep}"` : ""}. Retry resume using this step.`
                : `Cannot resume because run is currently "${latestStatus}".`,
            suspendedStep,
            error: errMsg,
          };
        } catch {
          // fall through to generic error response
        }
      }

      return {
        status: "error",
        workflowStatus: "failed",
        runId,
        message: `Error resuming workflow: ${errMsg}`,
        error: errMsg,
      };
    }
  },
});
