import { Mastra } from "@mastra/core";
<<<<<<< HEAD
import { AzureOpenAIGateway } from "@mastra/core/llm";
import { Observability, DefaultExporter } from "@mastra/observability";
=======
>>>>>>> audio-video
import { productionAgent } from "./agents/production";
import { audioVideoAgent } from "./agents/audio-video";
import { clipSelectorMultimodalAgent } from "./agents/audio-video/clip-selector-multimodal";
import { coordinatorAgent } from "./agents/coordinator";
import { silenceCutterWorkflow } from "./workflows/silence-cutter-workflow";
import { smartHighlightsV2Workflow } from "./workflows/smart-highlights-v2";
import { subtitleGeneratorWorkflow } from "./workflows/subtitle-generator-workflow";
import { sharedStore } from "./memory";
import { MultiResourceAzureGateway } from "./models/multi-resource-azure-gateway";
import {
  azureApiKey,
  azureApiVersion,
  azureDirectApiKey,
  azureGatewayDeployments,
  azureResourceName,
  gpt53ChatDeployment,
  normalizedAzureDirectBaseUrl,
} from "./models/azure-openai";

const directOverrides = normalizedAzureDirectBaseUrl
  ? {
      [gpt53ChatDeployment]: {
        baseURL: normalizedAzureDirectBaseUrl,
        apiKey: azureDirectApiKey,
      },
    }
  : undefined;

export const mastra = new Mastra({
  agents: { productionAgent, audioVideoAgent, coordinatorAgent, clipSelectorMultimodalAgent },
  workflows: { silenceCutterWorkflow, smartHighlightsV2Workflow, subtitleGeneratorWorkflow },
  gateways: {
    azureOpenAI: new MultiResourceAzureGateway({
      defaultResourceName: azureResourceName,
      defaultApiKey: azureApiKey,
      apiVersion: azureApiVersion,
      deployments: azureGatewayDeployments,
      overrides: directOverrides,
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
