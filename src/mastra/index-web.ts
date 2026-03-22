import { Mastra } from "@mastra/core"

import { coordinatorWebAgent } from "./agents/coordinator/index-web"
import { productionAgent } from "./agents/production"
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

const directOverrides = normalizedAzureDirectBaseUrl
  ? {
      [gpt53ChatDeployment]: {
        baseURL: normalizedAzureDirectBaseUrl,
        apiKey: azureDirectApiKey,
      },
    }
  : undefined

export const mastraWeb = new Mastra({
  agents: {
    coordinatorAgent: coordinatorWebAgent,
    productionAgent,
  },
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
