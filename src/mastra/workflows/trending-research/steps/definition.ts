import { createStep } from "@mastra/core/workflows"
import z from "zod"
import { definitionAgent } from "../agent"

export const definitionStep = createStep({
  id: "definition-research",
  inputSchema: z.object({
    topic: z.string().describe("The topic to research"),
  }),
  outputSchema: z.object({
    definition: z.string().describe("A clear definition of the topic"),
  }),
  execute: async ({ inputData }) => {
    const result = await definitionAgent.generate(
      `Investigate and provide a comprehensive definition of "${inputData.topic}". Include what it is, its purpose, and key concepts. Answer in the same language as the topic.`
    )
    return { definition: result.text }
  },
})
