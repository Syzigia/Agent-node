import { Mastra } from "@mastra/core";
import { assetAgent } from "./agents/asset";
import { contentAgent } from "./agents/content";
import { coordinatorAgent } from "./agents/coordinator";
import { silenceCutterWorkflow } from "./workflows/silence-cutter-workflow";
import { smartHighlightsClipperWorkflow } from "./workflows/smart-highlights-clipper";
import { sharedStore } from "./memory";

export const mastra = new Mastra({
  agents: { assetAgent, contentAgent, coordinatorAgent },
  workflows: { silenceCutterWorkflow, smartHighlightsClipperWorkflow },
  // Shared storage instance — required for workflow state persistence between start and resume
  storage: sharedStore,
});