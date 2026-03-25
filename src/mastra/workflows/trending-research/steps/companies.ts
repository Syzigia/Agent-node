import { createStep } from "@mastra/core/workflows"
import z from "zod"
import { companiesAgent } from "../agent"

export const companiesStep = createStep({
  id: "companies-research",
  inputSchema: z.object({
    topic: z.string().describe("The topic to research"),
  }),
  outputSchema: z.object({
    companies: z
      .string()
      .describe("Companies working on or related to the topic"),
  }),
  execute: async ({ inputData }) => {
    const result = await companiesAgent.generate(
      `Find and list companies, organizations, and key players that work with or are related to "${inputData.topic}". Include well-known companies, startups, and industry leaders. Answer in the same language as the topic.`
    )
    return { companies: result.text }
  },
})
