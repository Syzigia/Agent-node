import { createStep, createWorkflow } from "@mastra/core/workflows"
import z from "zod"
import { definitionStep } from "./steps/definition"
import { characteristicsStep } from "./steps/characteristics"
import { companiesStep } from "./steps/companies"

const combineStep = createStep({
  id: "combine-results",
  inputSchema: z.object({
    "definition-research": z.object({
      definition: z.string(),
    }),
    "characteristics-research": z.object({
      characteristics: z.string(),
    }),
    "companies-research": z.object({
      companies: z.string(),
    }),
  }),
  outputSchema: z.object({
    definition: z.string().describe("A definition of the topic"),
    characteristics: z
      .string()
      .describe("A list of characteristics of the topic"),
    companies: z.string().describe("A list of companies working on the topic"),
  }),
  execute: async ({ inputData }) => {
    return {
      definition: inputData["definition-research"].definition,
      characteristics: inputData["characteristics-research"].characteristics,
      companies: inputData["companies-research"].companies,
    }
  },
})

export const searchTrending = createWorkflow({
  id: "search-trending",
  inputSchema: z.object({
    topic: z.string().describe("The topic to search for trending research on"),
  }),
  outputSchema: z.object({
    definition: z.string().describe("A definition of the topic"),
    characteristics: z
      .string()
      .describe("A list of characteristics of the topic"),
    companies: z.string().describe("A list of companies working on the topic"),
  }),
})
  .parallel([definitionStep, characteristicsStep, companiesStep])
  .then(combineStep)
  .commit()
