import { Agent } from "@mastra/core/agent"
import { TokenLimiterProcessor } from "@mastra/core/processors"

import { coordinatorMemory } from "../../memory"
import { gpt53ChatModelId } from "../../models/azure-openai"
import { productionAgent } from "../production"
import { photosWebAgent } from "../photos/index-web"

export const coordinatorWebAgent = new Agent({
  id: "coordinator-agent",
  name: "Coordinator Agent",
  instructions: `You are the system coordinator for the web deployment.
You can delegate ONLY to production-agent.

Capabilities in this environment:
- Explore workspace files (list/search/read)
- Convert images to WebP
- Detect blurry photos
- Adjust photo gamma/brightness curves

If the user requests audio/video workflows or photo-analysis workflows, explain:
- Audio/video workflows and closed-eyes detection are disabled in this deployment profile
- Offer alternatives using current available capabilities

Rules:
1. Preserve user file paths exactly as provided.
2. Never invent absolute paths.
3. Delegate to production-agent when file exploration or WebP conversion is needed.
4. Delegate to photos-agent for blur detection and gamma adjustment.`,
  model: gpt53ChatModelId,
  agents: { productionAgent, photosAgent: photosWebAgent },
  inputProcessors: [new TokenLimiterProcessor(120_000)],
  defaultOptions: {
    delegation: {
      messageFilter: ({ messages }) => {
        return messages
          .filter((m) => {
            const parts = (m as any).content?.parts
            if (!Array.isArray(parts)) return true
            return !parts.every(
              (p: any) =>
                p.type === "tool-invocation" || p.type === "tool-result"
            )
          })
          .slice(-10)
      },
    },
  },
  memory: coordinatorMemory,
})
