import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { sanitizePath } from "../../../workspace";

/**
 * Tool 1: Starts the workflow. Detects silences and PAUSES.
 * Returns results for the agent to present to the user.
 */
export const startSilenceCutterTool = createTool({
  id: "start-silence-cutter",
  description: `Analyzes an audio or video file, detects silences,
and presents results for human review. Does NOT cut anything yet.

After calling this tool, ALWAYS:
1. Show the user the list of detected silences (from the "summary" field)
2. Ask if they approve the cuts
3. If approved -> call resume-silence-cutter with approved: true
4. If rejected -> call resume-silence-cutter with approved: false

Supported formats: mp4, mov, avi, mp3, m4a, wav, ogg, flac`,
  inputSchema: z.object({
    file: z.string().describe("Relative path within the workspace (e.g., podcast.m4a, wild_project.mp4)"),
    noiseThresholdDb: z.number().min(-60).max(-10).optional().default(-30),
    minSilenceDuration: z.number().min(0.1).max(10).optional().default(0.5),
  }),
  outputSchema: z.object({
    status: z.string(),
    runId: z.string().describe("Workflow run ID — pass to resume-silence-cutter"),
    summary: z.string(),
    segments: z.array(z.object({
      start: z.number(),
      end: z.number(),
      duration: z.number(),
    })),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    console.log("[startSilenceCutterTool] Starting execution...");
    console.log("[startSilenceCutterTool] Input:", JSON.stringify(inputData, null, 2));
    
    const file = sanitizePath(inputData.file);
    const { noiseThresholdDb, minSilenceDuration } = inputData;
    const { mastra } = context;
    
    if (!mastra) {
      console.error("[startSilenceCutterTool] ERROR: Mastra instance not available");
      throw new Error("Mastra instance not available in tool context");
    }
    
    console.log("[startSilenceCutterTool] Getting workflow...");
    const workflow = mastra.getWorkflow("silenceCutterWorkflow");

    if (!workflow) {
      console.error("[startSilenceCutterTool] ERROR: Workflow not found");
      return {
        status: "error",
        runId: "",
        summary: "",
        segments: [],
        message: "Workflow not found. Verify that silenceCutterWorkflow is registered.",
        error: "silenceCutterWorkflow not found",
      };
    }

    console.log("[startSilenceCutterTool] Workflow found");
    
    console.log("[startSilenceCutterTool] Creating run...");
    const run = await workflow.createRun();
    console.log("[startSilenceCutterTool] Run created with ID:", run.runId);

    console.log("[startSilenceCutterTool] Executing run.start()...");
    const result = await run.start({
      inputData: {
        file,
        noiseThresholdDb: noiseThresholdDb ?? -30,
        minSilenceDuration: minSilenceDuration ?? 0.5,
      },
    });
    console.log("[startSilenceCutterTool] Result of run.start():", JSON.stringify(result, null, 2));

    if (result.status === "suspended") {
      console.log("[startSilenceCutterTool] Workflow suspended successfully");
      const suspendedStepKey = result.suspended?.[0]?.[0] ?? "human-approval";
      const suspendPayload = result.steps?.[suspendedStepKey]?.suspendPayload as any;

      return {
        status: "awaiting_approval",
        runId: run.runId,
        summary: suspendPayload?.summary ?? "Could not retrieve the summary.",
        segments: suspendPayload?.segments ?? [],
        message: suspendPayload?.message ?? "Review the detected silences.",
      };
    }

    console.log("[startSilenceCutterTool] Workflow did NOT suspend. Status:", result.status);
    return {
      status: result.status,
      runId: run.runId,
      summary: "",
      segments: [],
      message: "The workflow did not reach the approval checkpoint. Verify the file exists.",
      error: "The workflow did not reach the approval checkpoint. Verify the file exists.",
    };
  },
});

/**
 * Tool 2: Resumes the workflow with the user's decision.
 * Automatically finds the last suspended run and resumes it.
 * Applies cuts if approved=true, cancels if approved=false.
 */
export const resumeSilenceCutterTool = createTool({
  id: "resume-silence-cutter",
  description: `Resumes the silence cutter workflow with the user's decision.
Automatically finds the last pending silence detection for approval.

Call ONLY after the user has reviewed the silences detected by start-silence-cutter.

- approved: true -> applies the cuts and generates the _cut file
- approved: false -> cancels without modifying anything

Always pass the runId returned by start-silence-cutter when available.`,
  inputSchema: z.object({
    runId: z.string().optional().describe("Run ID returned by start-silence-cutter. If not provided, searches for the last suspended run."),
    approved: z.boolean().describe("true = apply cuts, false = cancel"),
    preserveNaturalPauses: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    skipped: z.boolean(),
    output: z.string().optional(),
    secondsRemoved: z.number().optional(),
    originalDuration: z.number().optional(),
    newDuration: z.number().optional(),
    message: z.string(),
    error: z.string().optional(),
    status: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    console.log("[resumeSilenceCutterTool] Starting execution...");
    console.log("[resumeSilenceCutterTool] Input:", JSON.stringify(inputData, null, 2));
    
    const { runId: providedRunId, approved, preserveNaturalPauses } = inputData;
    const { mastra } = context;
    
    if (!mastra) {
      console.error("[resumeSilenceCutterTool] ERROR: Mastra instance not available");
      throw new Error("Mastra instance not available in tool context");
    }
    
    console.log("[resumeSilenceCutterTool] Getting workflow...");
    const workflow = mastra.getWorkflow("silenceCutterWorkflow");
    console.log("[resumeSilenceCutterTool] Workflow found:", workflow ? "YES" : "NO");
    
    // Determine runId: prefer provided, otherwise search for last suspended
    let runId: string;
    
    if (providedRunId) {
      console.log("[resumeSilenceCutterTool] Using provided runId:", providedRunId);
      runId = providedRunId;
    } else {
      // Search for suspended runs (fallback)
      console.log("[resumeSilenceCutterTool] No runId provided, searching for suspended runs...");
      const runs = await workflow.listWorkflowRuns({ 
        status: 'suspended',
        perPage: 1 
      });
      
      console.log("[resumeSilenceCutterTool] Runs found:", runs.runs?.length || 0);
      
      if (!runs.runs || runs.runs.length === 0) {
        console.error("[resumeSilenceCutterTool] ERROR: No suspended runs found");
        return {
          skipped: true,
          message: "No pending silence detection found. First analyze a file with start-silence-cutter.",
          status: "error",
          error: "No suspended runs available",
        };
      }
      
      const suspendedRun = runs.runs[0];
      if (!suspendedRun) {
        console.error("[resumeSilenceCutterTool] ERROR: Suspended run is undefined");
        return {
          skipped: true,
          message: "Error retrieving the suspended run.",
          status: "error",
          error: "Suspended run not available",
        };
      }
      
      runId = suspendedRun.runId;
    }
    
    console.log("[resumeSilenceCutterTool] Using runId:", runId);
    
    console.log("[resumeSilenceCutterTool] Creating run with ID:", runId);
    const run = await workflow.createRun({ runId });
    console.log("[resumeSilenceCutterTool] Run created");

    console.log("[resumeSilenceCutterTool] Executing run.resume()...");
    const result = await run.resume({
      step: "human-approval",
      resumeData: {
        approved,
        preserveNaturalPauses: preserveNaturalPauses ?? true,
      },
    });
    console.log("[resumeSilenceCutterTool] Result of run.resume():", JSON.stringify(result, null, 2));

    if (result.status === "success") {
      console.log("[resumeSilenceCutterTool] Workflow completed successfully");
      return result.result;
    }

    console.log("[resumeSilenceCutterTool] Workflow finished with status:", result.status);
    return {
      skipped: false,
      message: "The workflow finished with an unexpected status.",
      status: result.status,
      error: "The workflow finished with an unexpected status.",
    };
  },
});
