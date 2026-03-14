import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";

/**
 * Tool: Resumes the Smart Highlights Clipper workflow.
 *
 * This tool is FIRE-AND-FORGET: it triggers the resume and returns
 * immediately while the workflow continues processing in the background.
 * Use check-highlights-status to poll for progress after calling this tool.
 *
 * Can resume from two suspension points:
 * - config-step: provide user configuration (numberOfClips, targetDuration, etc.)
 * - select-clips: provide clip approval (approved, optional modifiedClips)
 */
export const resumeSmartHighlightsTool = createTool({
  id: "resume-smart-highlights",
  description: `Resumes the Smart Highlights Clipper workflow with user data.

This tool returns IMMEDIATELY while the workflow continues in the background.
After calling this tool, use check-highlights-status to poll for progress.

This tool can resume from two different points:

1. **Config Step** (first suspension): Receives user configuration
   - numberOfClips: Number of clips to generate (1-20)
   - targetDuration: Target duration in seconds (5-300)
   - contentType: "visual" or "textual"
   - outputFolder: Output folder

2. **Select Step** (second suspension): Receives clip approval
   - approved: true to generate, false to cancel
   - modifiedClips: Optional array of user-modified clips [{start, end}]

Always pass the runId returned by start-smart-highlights.

After calling this tool, poll check-highlights-status every 15-30 seconds
until the workflow reaches the next state (suspended or success).`,
  inputSchema: z.object({
    runId: z.string().describe("Run ID returned by start-smart-highlights. Required."),
    step: z.enum(["config-step", "select-clips"]).describe("Step to resume from"),
    config: z.object({
      numberOfClips: z.number().min(1).max(20).optional(),
      targetDuration: z.number().min(5).max(300).optional(),
      contentType: z.enum(["visual", "textual"]).optional(),
      outputFolder: z.string().optional(),
    }).optional(),
    approval: z.object({
      approved: z.boolean(),
      modifiedClips: z.array(z.object({
        start: z.number(),
        end: z.number(),
      })).optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    runId: z.string(),
    message: z.string(),
    status: z.string(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    console.log("[resumeSmartHighlights] Starting execution...");
    console.log("[resumeSmartHighlights] Input:", JSON.stringify(inputData, null, 2));

    const { runId, step, config, approval } = inputData;
    const { mastra } = context;

    if (!mastra) {
      console.error("[resumeSmartHighlights] ERROR: Mastra instance not available");
      throw new Error("Mastra instance not available in tool context");
    }

    const workflow = mastra.getWorkflow("smartHighlightsClipperWorkflow");
    if (!workflow) {
      return {
        success: false,
        runId: runId ?? "",
        message: "Workflow not found. Verify that it is registered.",
        status: "error",
        error: "Workflow smartHighlightsClipperWorkflow not found",
      };
    }

    // --- Validate the run exists and is actually suspended ---
    let runState: any;
    try {
      runState = await workflow.getWorkflowRunById(runId);
    } catch (err) {
      console.error("[resumeSmartHighlights] Error fetching run state:", err);
    }

    if (runState) {
      console.log(`[resumeSmartHighlights] Run ${runId} current status: ${runState.status}`);
      if (runState.status !== "suspended") {
        // Provide diagnostic info instead of letting _resume() throw
        const stepStatuses: string[] = [];
        if (runState.steps) {
          for (const [stepId, stepResult] of Object.entries(runState.steps as Record<string, any>)) {
            if (stepResult?.status) {
              stepStatuses.push(`${stepId}=${stepResult.status}`);
            }
          }
        }
        return {
          success: false,
          runId,
          message: `Cannot resume: workflow status is "${runState.status}", not "suspended". Step statuses: [${stepStatuses.join(", ")}]. The workflow may still be processing — use check-highlights-status to poll.`,
          status: runState.status,
          error: `Run ${runId} is not suspended (status: ${runState.status})`,
        };
      }
    } else {
      console.warn(`[resumeSmartHighlights] Could not verify run state for ${runId}, proceeding anyway`);
    }

    // --- Build resumeData based on the step ---
    let resumeData: any;

    if (step === "config-step" && config) {
      resumeData = {
        numberOfClips: config.numberOfClips ?? 3,
        targetDuration: config.targetDuration ?? 15,
        contentType: config.contentType ?? "textual",
        outputFolder: config.outputFolder ?? "highlights",
      };
    } else if (step === "select-clips" && approval) {
      // When user approves without modifications, retrieve the LLM-proposed
      // clips from the persisted suspend payload so the workflow uses them
      // directly instead of falling back to algorithmic selection.
      let clipsToUse = approval.modifiedClips;

      if (approval.approved && (!clipsToUse || clipsToUse.length === 0)) {
        console.log("[resumeSmartHighlights] Approved without modifications, retrieving proposed clips from snapshot...");
        try {
          // runState was already fetched above and status is "suspended"
          if (runState?.steps) {
            const selectStep = (runState.steps as Record<string, any>)["select-clips"];
            const payload = selectStep?.suspendPayload;
            if (payload?.proposedClips && payload.proposedClips.length > 0) {
              clipsToUse = payload.proposedClips.map((clip: any) => ({
                start: clip.start,
                end: clip.end,
              }));
              console.log(`[resumeSmartHighlights] Forwarding ${clipsToUse!.length} proposed clips as modifiedClips`);
            }
          }
        } catch (err) {
          console.warn("[resumeSmartHighlights] Could not retrieve proposed clips, falling back to algorithmic:", err);
        }
      }

      resumeData = {
        approved: approval.approved,
        modifiedClips: clipsToUse,
      };
    } else {
      return {
        success: false,
        runId,
        message: `Invalid resume data for step "${step}". For config-step provide config, for select-clips provide approval.`,
        status: "error",
        error: "Invalid resume data",
      };
    }

    // --- Create the run and fire-and-forget the resume ---
    try {
      const run = await workflow.createRun({ runId });
      console.log(`[resumeSmartHighlights] Firing resume for step "${step}" (fire-and-forget)`);
      console.log("[resumeSmartHighlights] Resume data:", JSON.stringify(resumeData, null, 2));

      // Fire-and-forget: DO NOT await. The workflow continues in the background.
      // Attach .then/.catch for server-side logging only.
      run.resume({ step, resumeData })
        .then((result: any) => {
          console.log(`[resumeSmartHighlights] Background resume completed. Status: ${result?.status}`);
          if (result?.status === "suspended") {
            const suspendedStep = result.suspended?.[0]?.[0] ?? "unknown";
            console.log(`[resumeSmartHighlights] Workflow suspended at step: ${suspendedStep}`);
          } else if (result?.status === "success") {
            console.log("[resumeSmartHighlights] Workflow completed successfully in background.");
          } else {
            console.log("[resumeSmartHighlights] Workflow finished with status:", result?.status);
          }
        })
        .catch((err: any) => {
          console.error("[resumeSmartHighlights] Background resume error:", err?.message ?? err);
        });

      // Return immediately
      const stepLabel = step === "config-step"
        ? "Processing video (audio extraction, transcription, scoring). This takes several minutes."
        : "Generating highlight clips. This may take a few minutes.";

      return {
        success: true,
        runId,
        message: `Resume triggered for step "${step}". ${stepLabel} Use check-highlights-status to poll for progress.`,
        status: "processing",
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[resumeSmartHighlights] Error creating run or triggering resume:", errMsg);
      return {
        success: false,
        runId,
        message: `Error resuming workflow: ${errMsg}`,
        status: "error",
        error: errMsg,
      };
    }
  },
});
