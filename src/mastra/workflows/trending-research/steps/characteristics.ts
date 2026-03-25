import { createStep } from "@mastra/core/workflows"
import z from "zod"
import { characteristicsAgent } from "../agent"

export const characteristicsStep = createStep({
  id: "characteristics-research",
  inputSchema: z.object({
    topic: z.string().describe("The topic to research"),
  }),
  outputSchema: z.object({
    characteristics: z
      .string()
      .describe("Main characteristics and features of the topic"),
  }),
  execute: async ({ inputData }) => {
    const result = await characteristicsAgent.generate(
      `Research and list the main characteristics, features, and key aspects of "${inputData.topic}". Include technical details, use cases, and important attributes. Answer in the same language as the topic.`
    )
    return { characteristics: result.text }
  },
})
