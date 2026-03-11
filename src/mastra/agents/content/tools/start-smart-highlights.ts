import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolExecutionContext } from "@mastra/core/tools";
import { sanitizePath } from "../../../workspace";

/**
 * Tool: Starts the Smart Highlights Clipper workflow.
 * Analyzes the video and pauses for user configuration.
 * Returns the results for the agent to display to the user.
 */
export const startSmartHighlightsTool = createTool({
  id: "start-smart-highlights",
  description: `Analyzes a video and prepares intelligent highlight extraction.

This tool:
1. Extracts audio from the video
2. Transcribes the audio using Whisper
3. Analyzes the visual content
4. Calculates weighted scores for each moment
5. Suspends for the user to configure parameters

After calling this tool, ALWAYS:
1. Show the user the configuration options (from the "configOptions" field)
2. Ask for: number of clips, target duration, content type, output folder
3. Call resume-smart-highlights with the user's configuration

Supported formats: mp4, mov, avi, mkv, webm`,
  inputSchema: z.object({
    file: z.string().describe("Relative path to workspace (e.g.: wild_project.mp4)"),
  }),
  outputSchema: z.object({
    status: z.string(),
    runId: z.string().describe("Workflow run ID — pass to resume-smart-highlights"),
    file: z.string(),
    costWarning: z.string().optional(),
    defaultConfig: z.object({
      numberOfClips: z.number(),
      targetDuration: z.number(),
      contentType: z.enum(["visual", "textual"]),
      outputFolder: z.string(),
    }),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context: ToolExecutionContext) => {
    console.log("[startSmartHighlightsTool] Starting execution...");
    console.log("[startSmartHighlightsTool] Input:", JSON.stringify(inputData, null, 2));
    
    const file = sanitizePath(inputData.file);
    const { mastra } = context;
    
    if (!mastra) {
      console.error("[startSmartHighlightsTool] ERROR: Mastra instance not available");
      throw new Error("Mastra instance not available in tool context");
    }
    
    console.log("[startSmartHighlightsTool] Getting workflow...");
    const workflow = mastra.getWorkflow("smartHighlightsClipperWorkflow");
    console.log("[startSmartHighlightsTool] Workflow found:", workflow ? "YES" : "NO");
    
    if (!workflow) {
      return {
        status: "error",
        runId: "",
        file,
        defaultConfig: {
          numberOfClips: 3,
          targetDuration: 15,
          contentType: "textual" as const,
          outputFolder: "highlights",
        },
        message: "Workflow not found. Verify that it is registered.",
        error: "Workflow smartHighlightsClipperWorkflow not found",
      };
    }
    
    console.log("[startSmartHighlightsTool] Creating run...");
    const run = await workflow.createRun();
    console.log("[startSmartHighlightsTool] Run created with ID:", run.runId);

    console.log("[startSmartHighlightsTool] Executing run.start()...");
    const result = await run.start({
      inputData: {
        file,
      },
    });
    console.log("[startSmartHighlightsTool] Result of run.start():", JSON.stringify(result, null, 2));

    if (result.status === "suspended") {
      console.log("[startSmartHighlightsTool] Workflow suspended successfully");
      const suspendedStepKey = result.suspended?.[0]?.[0] ?? "config-step";
      const suspendPayload = result.steps?.[suspendedStepKey]?.suspendPayload as any;

      return {
        status: "awaiting_configuration",
        runId: run.runId,
        file,
        costWarning: suspendPayload?.costWarning,
        defaultConfig: suspendPayload?.defaultValues ?? {
          numberOfClips: 3,
          targetDuration: 15,
          contentType: "textual" as const,
          outputFolder: "highlights",
        },
        message: suspendPayload?.message ?? "Configure the highlight extraction parameters.",
      };
    }

    console.log("[startSmartHighlightsTool] Workflow did NOT suspend. Status:", result.status);
    return {
      status: result.status,
      runId: run.runId,
      file,
      defaultConfig: {
        numberOfClips: 3,
        targetDuration: 15,
        contentType: "textual" as const,
        outputFolder: "highlights",
      },
      message: "The workflow did not reach the configuration checkpoint. Verify that the file exists.",
      error: "The workflow did not reach the configuration checkpoint. Verify that the file exists.",
    };
  },
});
