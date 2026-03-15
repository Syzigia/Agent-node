import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";

export const checkSubtitleStatusTool = createTool({
  id: "check-subtitle-status",
  description: `Checks the current status of a subtitle-generator workflow run.

Use this tool when resume-subtitle-generator fails with messages like "run was not suspended"
or to inspect whether a run is suspended, running, success, or failed.`,
  inputSchema: z.object({
    runId: z.string().describe("Workflow run ID returned by start-subtitle-generator"),
  }),
  outputSchema: z.object({
    status: z.enum(["running", "suspended", "success", "failed", "not_found"]),
    runId: z.string(),
    message: z.string(),
    workflowStatus: z.string().optional(),
    suspendedAtStep: z.string().optional(),
    suspendPayload: z.record(z.string(), z.unknown()).optional(),
    completedSteps: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    const { runId } = inputData;
    const { mastra } = context;

    if (!mastra) {
      throw new Error("Mastra instance not available in tool context");
    }

    const workflow = mastra.getWorkflow("subtitleGeneratorWorkflow");
    if (!workflow) {
      return {
        status: "not_found" as const,
        runId,
        message: "Workflow subtitleGeneratorWorkflow not found.",
      };
    }

    let runState: any;
    try {
      runState = await workflow.getWorkflowRunById(runId);
    } catch (err) {
      return {
        status: "not_found" as const,
        runId,
        message: `Could not retrieve run ${runId}: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }

    if (!runState) {
      return {
        status: "not_found" as const,
        runId,
        message: `No workflow run found with ID ${runId}.`,
      };
    }

    const workflowStatus = runState.status as string;
    const completedSteps: string[] = [];
    if (runState.steps) {
      for (const [stepId, stepResult] of Object.entries(runState.steps as Record<string, any>)) {
        if (stepResult?.status === "success") {
          completedSteps.push(stepId);
        }
      }
    }

    if (workflowStatus === "running" || workflowStatus === "waiting") {
      return {
        status: "running" as const,
        runId,
        workflowStatus,
        message: "Subtitle workflow is still processing.",
        completedSteps,
      };
    }

    if (workflowStatus === "suspended") {
      let suspendedAtStep = "unknown";
      let suspendPayload: any;

      if (runState.steps) {
        for (const [stepId, stepResult] of Object.entries(runState.steps as Record<string, any>)) {
          if (stepResult?.status === "suspended") {
            suspendedAtStep = stepId;
            suspendPayload = stepResult?.suspendPayload;
            break;
          }
        }
      }

      return {
        status: "suspended" as const,
        runId,
        workflowStatus,
        message: `Subtitle workflow is suspended at step "${suspendedAtStep}".`,
        suspendedAtStep,
        suspendPayload,
        completedSteps,
      };
    }

    if (workflowStatus === "success" || workflowStatus === "completed") {
      return {
        status: "success" as const,
        runId,
        workflowStatus,
        message: "Subtitle workflow completed successfully.",
        completedSteps,
      };
    }

    const errorInfo = runState.error ?? runState.result?.error;
    return {
      status: "failed" as const,
      runId,
      workflowStatus,
      message: `Subtitle workflow ended with status "${workflowStatus}".`,
      completedSteps,
      error: typeof errorInfo === "string" ? errorInfo : JSON.stringify(errorInfo),
    };
  },
});
