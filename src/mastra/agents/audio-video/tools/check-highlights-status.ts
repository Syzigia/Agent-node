import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";

/**
 * Tool: Polls the Smart Highlights Clipper workflow for its current status.
 *
 * Because the resume tool fires-and-forgets (returns immediately while the
 * workflow keeps running in the background), the agent must poll this tool
 * to know when the workflow reaches the next suspension point or completes.
 *
 * Typical polling cadence: every 15-30 seconds.
 */
export const checkHighlightsStatusTool = createTool({
  id: "check-highlights-status",
  description: `Check the current status of a Smart Highlights Clipper workflow run.

Use this tool to poll for progress after calling resume-smart-highlights.
The resume tool returns immediately while the workflow continues in the background.

Status values:
- "running": Workflow is still processing (poll again in 15-30s)
- "suspended": Workflow is waiting for user input (show the suspension details)
- "success": Workflow completed successfully (show the results)
- "failed": Workflow encountered an error

When status is "suspended", the response includes the suspend payload with
proposed clips for user review. When status is "success", it includes the
final output with generated clip paths.`,
  inputSchema: z.object({
    runId: z.string().describe("The workflow run ID returned by start-smart-highlights or resume-smart-highlights"),
  }),
  outputSchema: z.object({
    status: z.enum(["running", "suspended", "success", "failed", "not_found"]),
    runId: z.string(),
    message: z.string(),
    // Suspension details (when status === "suspended")
    suspendedAtStep: z.string().optional(),
    proposedClips: z.array(z.object({
      start: z.number(),
      end: z.number(),
      reason: z.string().optional(),
    })).optional(),
    suspendedConfig: z.object({
      numberOfClips: z.number(),
      targetDuration: z.number(),
      contentType: z.string(),
    }).optional(),
    // Success details (when status === "success")
    outputFolder: z.string().optional(),
    clipsGenerated: z.number().optional(),
    clips: z.array(z.object({
      filename: z.string(),
      path: z.string(),
      duration: z.number(),
    })).optional(),
    processingTime: z.number().optional(),
    // Error details (when status === "failed")
    error: z.string().optional(),
    // Step progress
    completedSteps: z.array(z.string()).optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    const { runId } = inputData;
    const { mastra } = context;

    if (!mastra) {
      throw new Error("Mastra instance not available in tool context");
    }

    const workflow = mastra.getWorkflow("smartHighlightsClipperWorkflow");
    if (!workflow) {
      return {
        status: "not_found" as const,
        runId,
        message: "Workflow smartHighlightsClipperWorkflow not found.",
      };
    }

    // Retrieve the run state from the persisted snapshot
    let runState: any;
    try {
      runState = await workflow.getWorkflowRunById(runId);
    } catch (err) {
      console.error("[checkHighlightsStatus] Error fetching run:", err);
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

    const currentStatus = runState.status as string;
    console.log(`[checkHighlightsStatus] Run ${runId} status: ${currentStatus}`);

    // Collect completed steps for progress reporting
    const completedSteps: string[] = [];
    if (runState.steps) {
      for (const [stepId, stepResult] of Object.entries(runState.steps as Record<string, any>)) {
        if (stepResult?.status === "success") {
          completedSteps.push(stepId);
        }
      }
    }

    // --- RUNNING ---
    if (currentStatus === "running" || currentStatus === "waiting") {
      return {
        status: "running" as const,
        runId,
        message: `Workflow is still processing. Completed steps: ${completedSteps.length > 0 ? completedSteps.join(", ") : "none yet"}. Poll again in 15-30 seconds.`,
        completedSteps,
      };
    }

    // --- SUSPENDED ---
    if (currentStatus === "suspended") {
      // Find which step is suspended
      let suspendedAtStep = "unknown";
      let suspendPayload: any = null;

      if (runState.steps) {
        for (const [stepId, stepResult] of Object.entries(runState.steps as Record<string, any>)) {
          if (stepResult?.status === "suspended") {
            suspendedAtStep = stepId;
            suspendPayload = stepResult?.suspendPayload;
            break;
          }
        }
      }

      // Build response based on which step is suspended
      if (suspendedAtStep === "config-step") {
        return {
          status: "suspended" as const,
          runId,
          message: suspendPayload?.message ?? "Workflow is waiting for configuration.",
          suspendedAtStep,
          completedSteps,
        };
      }

      if (suspendedAtStep === "select-clips") {
        return {
          status: "suspended" as const,
          runId,
          message: suspendPayload?.message ?? "Workflow is waiting for clip approval.",
          suspendedAtStep,
          proposedClips: suspendPayload?.proposedClips,
          suspendedConfig: suspendPayload?.config,
          completedSteps,
        };
      }

      // Generic suspended
      return {
        status: "suspended" as const,
        runId,
        message: `Workflow is suspended at step "${suspendedAtStep}".`,
        suspendedAtStep,
        completedSteps,
      };
    }

    // --- SUCCESS ---
    if (currentStatus === "success" || currentStatus === "completed") {
      // Extract final result from the last step (cleanup or generate-clips)
      const cleanupResult = (runState.steps as Record<string, any>)?.["cleanup"]?.output;
      const generateResult = (runState.steps as Record<string, any>)?.["generate-clips"]?.output;
      const finalResult = cleanupResult ?? generateResult;

      return {
        status: "success" as const,
        runId,
        message: finalResult?.success
          ? `Highlights generated successfully. ${finalResult.clipsGenerated} clips saved to ${finalResult.outputFolder}.`
          : "Workflow completed.",
        outputFolder: finalResult?.outputFolder,
        clipsGenerated: finalResult?.clipsGenerated,
        clips: finalResult?.clips,
        processingTime: finalResult?.processingTime,
        completedSteps,
      };
    }

    // --- FAILED / OTHER ---
    const errorInfo = runState.error ?? runState.result?.error;
    return {
      status: "failed" as const,
      runId,
      message: `Workflow ended with status "${currentStatus}".`,
      error: typeof errorInfo === "string" ? errorInfo : JSON.stringify(errorInfo),
      completedSteps,
    };
  },
});
