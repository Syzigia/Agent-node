import { Mastra } from "@mastra/core";
import { AzureOpenAIGateway } from "@mastra/core/llm";
import { Observability, DefaultExporter } from "@mastra/observability";
import { productionAgent } from "./agents/production";
import { audioVideoAgent } from "./agents/audio-video";
import { coordinatorAgent } from "./agents/coordinator";
import { silenceCutterWorkflow } from "./workflows/silence-cutter-workflow";
import { smartHighlightsClipperWorkflow } from "./workflows/smart-highlights-clipper";
import { subtitleGeneratorWorkflow } from "./workflows/subtitle-generator-workflow";
import { sharedStore } from "./memory";
import {
  azureApiKey,
  azureApiVersion,
  azureGatewayDeployments,
  azureResourceName,
} from "./models/azure-openai";

export const mastra = new Mastra({
  agents: { productionAgent, audioVideoAgent, coordinatorAgent },
  workflows: { silenceCutterWorkflow, smartHighlightsClipperWorkflow, subtitleGeneratorWorkflow },
  gateways: {
    azureOpenAI: new AzureOpenAIGateway({
      resourceName: azureResourceName,
      apiKey: azureApiKey,
      apiVersion: azureApiVersion,
      deployments: azureGatewayDeployments,
    }),
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: "production-studio",
        exporters: [new DefaultExporter()],
      },
    },
  }),
  // Shared storage instance — required for workflow state persistence between start and resume
  storage: sharedStore,
});
