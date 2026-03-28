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
import { publishAgent } from "./agents/publish"

const directOverrides = normalizedAzureDirectBaseUrl
  ? {
      [gpt53ChatDeployment]: {
        baseURL: normalizedAzureDirectBaseUrl,
        apiKey: azureDirectApiKey,
      },
    }
  : undefined

export const mastra = new Mastra({
  agents: { productionAgent, coordinatorAgent, photosAgent, publishAgent },
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
