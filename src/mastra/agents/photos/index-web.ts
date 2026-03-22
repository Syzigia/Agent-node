import { Agent } from "@mastra/core/agent"

import { agentMemory } from "../../memory"
import { gpt5MiniModelId } from "../../models/azure-openai"
import { getWorkspace } from "../../workspace/context"
import { blurredPhotosDetectorTool } from "./tools/blurred-photos-detector"
import { changeGammaTool } from "./tools/change-gamma"

export const photosWebAgent = new Agent({
  id: "photos-agent",
  name: "Photos Agent",
  instructions: `You are a photo enhancement specialist for the web-lite deployment.

Available capabilities in this environment:
1) Detect blurry or out-of-focus photos (blurred-photos-detector)
2) Adjust gamma with predefined curves (change-gamma)

Not available in this environment:
- Closed-eyes detection (disabled in web-lite profile)

Rules:
- Preserve file paths exactly as provided by the user.
- Never invent absolute paths.
- For gamma, only use enum values: apple, srgb, broadcast.
- If the user asks for closed-eyes detection, explain this capability is disabled in web-lite and offer blur/gamma alternatives.`,
  model: gpt5MiniModelId,
  workspace: ({ requestContext }) => getWorkspace({ requestContext }),
  tools: { blurredPhotosDetectorTool, changeGammaTool },
  memory: agentMemory,
})
