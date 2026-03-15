import { Mastra } from "@mastra/core";
import { productionAgent } from "./agents/production";
import { audioVideoAgent } from "./agents/audio-video";
import { coordinatorAgent } from "./agents/coordinator";
import { silenceCutterWorkflow } from "./workflows/silence-cutter-workflow";
import { smartHighlightsClipperWorkflow } from "./workflows/smart-highlights-clipper";
import { subtitleGeneratorWorkflow } from "./workflows/subtitle-generator-workflow";
import { sharedStore } from "./memory";

export const mastra = new Mastra({
  agents: { productionAgent, audioVideoAgent, coordinatorAgent },
  workflows: { silenceCutterWorkflow, smartHighlightsClipperWorkflow, subtitleGeneratorWorkflow },
  // Shared storage instance — required for workflow state persistence between start and resume
  storage: sharedStore,
});