import { createTool } from "@mastra/core/tools"
import type { ToolExecutionContext } from "@mastra/core/tools"
import { z } from "zod"

import { sanitizePath } from "../../../workspace"
import { getFilesystem, resolveS3MediaPath } from "../../../workspace/context"
import { proposedClipSchema } from "../../../tools/smart-highlights-v2/types"
import {
  DEFAULT_APPROX_TARGET_DURATION,
  DEFAULT_NUMBER_OF_CLIPS,
  DEFAULT_OUTPUT_FOLDER,
} from "../../../tools/smart-highlights-v2/constants"

const startOutputSchema = z.object({
  status: z.string(),
  runId: z.string(),
  file: z.string(),
  message: z.string(),
  defaultConfig: z.object({
    numberOfClips: z.number(),
    targetDurationApprox: z.number(),
    outputFolder: z.string(),
  }),
  error: z.string().optional(),
})

const resumeOutputSchema = z.object({
  success: z.boolean(),
  runId: z.string(),
  status: z.string(),
  message: z.string(),
  suspendedAtStep: z.string().optional(),
  error: z.string().optional(),
})

const statusOutputSchema = z.object({
  status: z.enum(["running", "suspended", "success", "failed", "not_found"]),
  runId: z.string(),
  message: z.string(),
  suspendedAtStep: z.string().optional(),
  proposedClips: z.array(proposedClipSchema).optional(),
  outputFolder: z.string().optional(),
  clipsGenerated: z.number().optional(),
  clips: z
    .array(
      z.object({
        filename: z.string(),
        path: z.string(),
        duration: z.number(),
        strategy: z.enum(["stream-copy", "reencode"]),
      })
    )
    .optional(),
  processingTime: z.number().optional(),
  error: z.string().optional(),
  completedSteps: z.array(z.string()).optional(),
})

export const startSmartHighlightsV2Tool = createTool({
  id: "start-smart-highlights-v2",
  description:
    "Analyze a video for smart highlights v2 using word timestamps, frame sampling, multimodal ranking, and copy-if-safe clip generation.",
  inputSchema: z.object({
    file: z.string().describe("Relative path to a video file in the workspace"),
  }),
  outputSchema: startOutputSchema,
  execute: async (inputData, context: ToolExecutionContext) => {
    let file: string
    const filesystem = getFilesystem(context)

    try {
      file = (
        await resolveS3MediaPath(filesystem, sanitizePath(inputData.file))
      ).resolvedPath
    } catch (error) {
      return {
        status: "error",
        runId: "",
        file: inputData.file,
        message: error instanceof Error ? error.message : String(error),
        defaultConfig: {
          numberOfClips: DEFAULT_NUMBER_OF_CLIPS,
          targetDurationApprox: DEFAULT_APPROX_TARGET_DURATION,
          outputFolder: DEFAULT_OUTPUT_FOLDER,
        },
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const workflow = context.mastra?.getWorkflow("smartHighlightsV2Workflow")

    if (!workflow) {
      return {
        status: "error",
        runId: "",
        file,
        message: "Workflow smartHighlightsV2Workflow is not registered.",
        defaultConfig: {
          numberOfClips: DEFAULT_NUMBER_OF_CLIPS,
          targetDurationApprox: DEFAULT_APPROX_TARGET_DURATION,
          outputFolder: DEFAULT_OUTPUT_FOLDER,
        },
        error: "smartHighlightsV2Workflow not found",
      }
    }

    const run = await workflow.createRun()
    const result = await run.start({
      inputData: { file },
      requestContext: context.requestContext,
    })

    if (result.status === "suspended") {
      const suspendedStepKey = result.suspended?.[0]?.[0] ?? "v2-config-step"
      const suspendPayload = result.steps?.[suspendedStepKey]
        ?.suspendPayload as
        | {
            message?: string
            defaultValues?: {
              numberOfClips?: number
              targetDurationApprox?: number
              outputFolder?: string
            }
          }
        | undefined

      return {
        status: "awaiting_configuration",
        runId: run.runId,
        file,
        message:
          suspendPayload?.message ??
          "Provide clip count and approximate duration.",
        defaultConfig: {
          numberOfClips:
            suspendPayload?.defaultValues?.numberOfClips ??
            DEFAULT_NUMBER_OF_CLIPS,
          targetDurationApprox:
            suspendPayload?.defaultValues?.targetDurationApprox ??
            DEFAULT_APPROX_TARGET_DURATION,
          outputFolder:
            suspendPayload?.defaultValues?.outputFolder ??
            DEFAULT_OUTPUT_FOLDER,
        },
      }
    }

    return {
      status: result.status,
      runId: run.runId,
      file,
      message: "The workflow did not stop at the configuration checkpoint.",
      defaultConfig: {
        numberOfClips: DEFAULT_NUMBER_OF_CLIPS,
        targetDurationApprox: DEFAULT_APPROX_TARGET_DURATION,
        outputFolder: DEFAULT_OUTPUT_FOLDER,
      },
      error: "Unexpected workflow state",
    }
  },
})

export const resumeSmartHighlightsV2Tool = createTool({
  id: "resume-smart-highlights-v2",
  description:
    "Resume smart highlights v2 at either the config step or the approval step. Resume is fire-and-forget; poll status afterwards.",
  inputSchema: z.object({
    runId: z.string(),
    step: z.enum(["v2-config-step", "v2-approval-step"]),
    config: z
      .object({
        numberOfClips: z.number().min(1).max(20).optional(),
        targetDurationApprox: z.number().min(10).max(180).optional(),
        outputFolder: z.string().optional(),
      })
      .optional(),
    approval: z
      .object({
        approved: z.boolean(),
        modifiedClips: z
          .array(
            z.object({
              start: z.number(),
              end: z.number(),
            })
          )
          .optional(),
      })
      .optional(),
  }),
  outputSchema: resumeOutputSchema,
  execute: async (inputData, context: ToolExecutionContext) => {
    const workflow = context.mastra?.getWorkflow("smartHighlightsV2Workflow")
    if (!workflow) {
      return {
        success: false,
        runId: inputData.runId,
        status: "error",
        message: "Workflow smartHighlightsV2Workflow is not registered.",
        error: "smartHighlightsV2Workflow not found",
      }
    }

    const runState = await workflow
      .getWorkflowRunById(inputData.runId)
      .catch(() => null)
    if (!runState) {
      return {
        success: false,
        runId: inputData.runId,
        status: "error",
        message: `Run ${inputData.runId} was not found.`,
        error: `Run ${inputData.runId} not found`,
      }
    }

    const suspendedEntry = Object.entries(
      (runState.steps ?? {}) as Record<string, any>
    ).find(([, stepResult]) => stepResult?.status === "suspended")
    const suspendedAtStep = suspendedEntry?.[0]

    if (runState.status !== "suspended") {
      return {
        success: false,
        runId: inputData.runId,
        status: runState.status,
        message: `Cannot resume because workflow status is \"${runState.status}\".`,
        error: `Run ${inputData.runId} is not suspended`,
      }
    }

    if (suspendedAtStep && suspendedAtStep !== inputData.step) {
      return {
        success: false,
        runId: inputData.runId,
        status: "error",
        message: `This run is suspended at \"${suspendedAtStep}\", not \"${inputData.step}\".`,
        suspendedAtStep,
        error: `Expected suspended step ${suspendedAtStep}`,
      }
    }

    const resumeData =
      inputData.step === "v2-config-step"
        ? {
            numberOfClips:
              inputData.config?.numberOfClips ?? DEFAULT_NUMBER_OF_CLIPS,
            targetDurationApprox:
              inputData.config?.targetDurationApprox ??
              DEFAULT_APPROX_TARGET_DURATION,
            outputFolder:
              inputData.config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER,
          }
        : {
            approved: inputData.approval?.approved ?? false,
            modifiedClips: inputData.approval?.modifiedClips,
          }

    const run = await workflow.createRun({ runId: inputData.runId })
    try {
      void run
        .resume({
          step: inputData.step,
          resumeData,
          requestContext: context.requestContext,
        })
        .catch((error) => {
          console.error(
            "[resumeSmartHighlightsV2Tool] Background resume failed:",
            error
          )
        })
    } catch (error) {
      return {
        success: false,
        runId: inputData.runId,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        suspendedAtStep,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return {
      success: true,
      runId: inputData.runId,
      status: "processing",
      suspendedAtStep,
      message:
        inputData.step === "v2-config-step"
          ? "Resume triggered. Processing transcription, frames, scenes, and multimodal ranking in the background."
          : "Resume triggered. Generating clips in the background.",
    }
  },
})

export const checkSmartHighlightsV2StatusTool = createTool({
  id: "check-smart-highlights-v2-status",
  description:
    "Poll smart highlights v2 workflow progress, proposed clips, or final generated outputs.",
  inputSchema: z.object({
    runId: z.string(),
  }),
  outputSchema: statusOutputSchema,
  execute: async (inputData, context: ToolExecutionContext) => {
    const workflow = context.mastra?.getWorkflow("smartHighlightsV2Workflow")
    if (!workflow) {
      return {
        status: "not_found" as const,
        runId: inputData.runId,
        message: "Workflow smartHighlightsV2Workflow is not registered.",
      }
    }

    const runState = await workflow
      .getWorkflowRunById(inputData.runId)
      .catch(() => null)
    if (!runState) {
      return {
        status: "not_found" as const,
        runId: inputData.runId,
        message: `No run found for ${inputData.runId}.`,
      }
    }

    const completedSteps = Object.entries(
      (runState.steps ?? {}) as Record<string, any>
    )
      .filter(([, stepResult]) => stepResult?.status === "success")
      .map(([stepId]) => stepId)

    if (runState.status === "running" || runState.status === "waiting") {
      return {
        status: "running" as const,
        runId: inputData.runId,
        message: `Workflow is still processing. Completed steps: ${completedSteps.join(", ") || "none"}.`,
        completedSteps,
      }
    }

    if (runState.status === "suspended") {
      const suspendedEntry = Object.entries(
        (runState.steps ?? {}) as Record<string, any>
      ).find(([, stepResult]) => stepResult?.status === "suspended")
      const suspendedAtStep = suspendedEntry?.[0] ?? "unknown"
      const suspendPayload = suspendedEntry?.[1]?.suspendPayload

      return {
        status: "suspended" as const,
        runId: inputData.runId,
        message:
          suspendPayload?.message ??
          `Workflow suspended at ${suspendedAtStep}.`,
        suspendedAtStep,
        proposedClips: suspendPayload?.proposedClips,
        completedSteps,
      }
    }

    if (runState.status === "success") {
      const cleanupOutput = (runState.steps as Record<string, any>)?.[
        "v2-cleanup"
      ]?.output
      return {
        status: "success" as const,
        runId: inputData.runId,
        message: cleanupOutput?.success
          ? `Generated ${cleanupOutput.clipsGenerated} clips into ${cleanupOutput.outputFolder}.`
          : "Workflow completed.",
        outputFolder: cleanupOutput?.outputFolder,
        clipsGenerated: cleanupOutput?.clipsGenerated,
        clips: cleanupOutput?.clips,
        processingTime: cleanupOutput?.processingTime,
        completedSteps,
      }
    }

    return {
      status: "failed" as const,
      runId: inputData.runId,
      message: `Workflow ended with status \"${runState.status}\".`,
      error:
        typeof runState.error === "string"
          ? runState.error
          : JSON.stringify(runState.error ?? runState.result?.error ?? null),
      completedSteps,
    }
  },
})
