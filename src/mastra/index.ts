import { Mastra } from "@mastra/core"
import { productionAgent } from "./agents/production"
import { coordinatorAgent } from "./agents/coordinator"
import { sharedStore } from "./memory"
import { MultiResourceAzureGateway } from "./models/multi-resource-azure-gateway"
import {
  azureApiKey,
  azureApiVersion,
  azureDirectApiKey,
  azureGatewayDeployments,
  azureResourceName,
  gpt53ChatDeployment,
  normalizedAzureDirectBaseUrl,
} from "./models/azure-openai"
import { photosAgent } from "./agents/photos"
import { creativeAgent } from "./agents/creative"
import { searchTrending } from "./workflows/trending-research/workflow"
import {
  projectExamplesAgent,
  visualInspirationAgent,
  industryShowcaseAgent,
  creativeDirectionsAgent,
} from "./workflows/trending-research/agent"
import { trandingResearchReportWorkflow } from "./workflows/trending-research-report/workflow"
import { writerAgent } from "./workflows/trending-research-report/agent"

const directOverrides = normalizedAzureDirectBaseUrl
  ? {
      [gpt53ChatDeployment]: {
        baseURL: normalizedAzureDirectBaseUrl,
        apiKey: azureDirectApiKey,
      },
    }
  : undefined

export const mastra = new Mastra({
  agents: {
    productionAgent,
    coordinatorAgent,
    photosAgent,
    projectExamplesAgent,
    visualInspirationAgent,
    industryShowcaseAgent,
    creativeDirectionsAgent,
    writerAgent,
    creativeAgent,
  },
  workflows: { searchTrending, trandingResearchReportWorkflow },
  gateways: {
    azureOpenAI: new MultiResourceAzureGateway({
      defaultResourceName: azureResourceName,
      defaultApiKey: azureApiKey,
      apiVersion: azureApiVersion,
      deployments: azureGatewayDeployments,
      overrides: directOverrides,
    }),
  },
  storage: sharedStore,
})
