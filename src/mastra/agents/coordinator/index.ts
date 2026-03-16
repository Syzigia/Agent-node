import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { coordinatorMemory } from "../../memory";
import { productionAgent } from "../production";
import { audioVideoAgent } from "../audio-video";
import { gpt5MiniModelId } from "../../models/azure-openai";

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
- Any task related to image files

### audio-video-agent
- Process audio or video
- Extract highlights/clips from a video → use smart-highlights
- Cut silences from podcasts or videos → use silence-cutter
- Isolate voice from audio/video → use demucs (local ONNX processing)
- Any media post-production task

## Important rules

1. **Paths**: Always pass paths EXACTLY as the user writes them.
   - If the user says "wild_project.mp4", pass "wild_project.mp4" — DO NOT add folders or prefixes.
   - NEVER invent absolute paths like /foo, /tmp, etc.

2. **Human approval**: For audio/video tasks involving cuts or modifications,
   the audio-video-agent has its own human approval flow (HITL).
   Do not force or speed up that process — the human must always review before changes are applied.

3. **runId**: The audio-video-agent returns a runId when starting workflows.
   When the user wants to continue/resume a process, pass the runId to the audio-video-agent.`,
  model: gpt5MiniModelId,
  agents: { productionAgent, audioVideoAgent },
  inputProcessors: [
    new TokenLimiterProcessor(120_000),
  ],
  defaultOptions: {
    delegation: {
      // Limit context forwarded to sub-agents: only pass the last 10 messages
      // and strip tool-invocation parts. Sub-agents don't need the full parent
      // conversation history — they receive a self-contained prompt from the
      // coordinator. Less context = faster Azure responses.
      messageFilter: ({ messages }) => {
        return messages
          .filter(m => {
            const parts = (m as any).content?.parts;
            if (!Array.isArray(parts)) return true;
            return !parts.every((p: any) => p.type === "tool-invocation" || p.type === "tool-result");
          })
          .slice(-10);
      },
    },
  },
  memory: coordinatorMemory,
});
