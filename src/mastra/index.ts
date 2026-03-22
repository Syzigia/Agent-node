import { Mastra } from "@mastra/core";
import { MastraAuthClerk } from "@mastra/auth-clerk";
import { VercelDeployer } from "@mastra/deployer-vercel";
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
import { photosAgent } from "./agents/photos";
import { apiRoutes } from "./server/routes";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { getProject } from "./db";

const directOverrides = normalizedAzureDirectBaseUrl
  ? {
      [gpt53ChatDeployment]: {
        baseURL: normalizedAzureDirectBaseUrl,
        apiKey: azureDirectApiKey,
      },
    }
  : undefined;

export const mastra = new Mastra({
  agents: { productionAgent, audioVideoAgent, coordinatorAgent, clipSelectorMultimodalAgent, photosAgent },
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
  storage: sharedStore,
  deployer: new VercelDeployer({
    maxDuration: 300,
  }),
  server: {
    auth: new MastraAuthClerk(),
    apiRoutes,
    middleware: [
      {
        path: "/api/*",
        handler: async (c, next) => {
          const requestContext = c.get("requestContext");
          const user = requestContext.get("user");

          // Force memory operations to the authenticated user
          if (user?.sub) {
            requestContext.set(MASTRA_RESOURCE_ID_KEY, user.sub);
          }

          // Resolve project workspace from X-Project-Id header
          const projectId = c.req.header("X-Project-Id");
          if (projectId) {
            const project = await getProject(projectId);
            if (project) {
              requestContext.set("s3Prefix", project.s3Prefix);
            }
          }

          return next();
        },
      },
    ],
    cors: {
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Project-Id"],
    },
  },
});
