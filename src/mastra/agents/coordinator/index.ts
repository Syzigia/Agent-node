import { Agent } from "@mastra/core/agent"
import { TokenLimiterProcessor } from "@mastra/core/processors"
import { coordinatorMemory } from "../../memory"
import { productionAgent } from "../production"
import { gpt53ChatModelId } from "../../models/azure-openai"
import { photosAgent } from "../photos"
import { creativeAgent } from "../creative"

export const coordinatorAgent = new Agent({
  id: "coordinator-agent",
  name: "Coordinator Agent",
  instructions: `You are the brain of the system. You delegate tasks to specialized domain agents.
Your only job is to understand the user's intent and delegate it to the correct agent.
DO NOT invent paths, DO NOT transform filenames — pass exactly what the user says.

## When to delegate to each agent:

### production-agent
- Explore workspace files (list, search)
- Convert images to WebP

### photos-agent
- Detect blurry or out-of-focus photos
- Filter, classify or analyze photo quality
- Adjust gamma/brightness of photos (change-gamma tool with options: apple, srgb, broadcast - saves to gamma_correction folder)
- Apply LUT (Look-Up Table) files (.cube) to images for color grading and color correction
- Any task related to photo quality, enhancement, color grading, or color correction

### creative-agent
- Research topics, trends, or any subject matter
- Generate comprehensive reports on any topic
- When user asks about "tendencias" (trends) on any topic
- When user says "busca" (search), "investiga" (research), "dime sobre" (tell me about)
- When user needs information about companies, technologies, concepts, or industries
- When user requests a report or analysis on any subject
- ANY research or information gathering request

## Important rules

1. **Paths**: Always pass paths EXACTLY as the user writes them.
   - If the user says "wild_project.mp4", pass "wild_project.mp4" — DO NOT add folders or prefixes.
   - NEVER invent absolute paths like /foo, /tmp, etc.

2. **Workspace tool arguments**: NEVER send null for optional tool fields.
   - If an optional field is not needed, omit it entirely.
   - Applies especially to list/search filters such as exclude, extension, and pattern.

3. **Filesystem-first resolution**: If a file path is missing, ambiguous, or a delegated tool reports "file not found", ALWAYS run a workspace discovery pass before concluding failure.
   - Delegate to production-agent to list/search the workspace and find matching candidates.
   - Retry delegation with the resolved exact path when possible.
   - Only ask the user to choose when multiple valid candidates remain.`,
  model: gpt53ChatModelId,
  agents: { productionAgent, photosAgent, creativeAgent },
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
