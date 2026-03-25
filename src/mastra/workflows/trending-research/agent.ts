import { Agent } from "@mastra/core/agent"
import { gpt53ChatModelId } from "../../models/azure-openai"
import Exa from "exa-js"
import { createTool } from "@mastra/core/tools"
import z from "zod"

const webSearchTool = createTool({
  id: "web-search",
  description: "Search the web for information",
  inputSchema: z.object({
    query: z.string().min(1).max(500).describe("The search query"),
  }),
  outputSchema: z.array(
    z.object({
      title: z.string().nullable(),
      url: z.string(),
      content: z.string(),
      publishedDate: z.string().optional(),
    })
  ),
  execute: async (inputData) => {
    const { results } = await exa.search(inputData.query, {
      numResults: 5,
    })

    return results.map((result) => ({
      title: result.title,
      url: result.url,
      content: result.text.slice(0, 500),
      publishedDate: result.publishedDate,
    }))
  },
})

export const definitionAgent = new Agent({
  id: "definition-agent",
  name: "Definition Agent",
  instructions:
    "You are an expert researcher specializing in providing clear, comprehensive definitions. Your task is to investigate topics and provide detailed definitions, including what they are, their purpose, and key concepts. Always cite your sources when possible and provide accurate, up-to-date information.",
  tools: { webSearchTool },
  model: gpt53ChatModelId,
})

export const characteristicsAgent = new Agent({
  id: "characteristics-agent",
  name: "Characteristics Agent",
  instructions:
    "You are an expert researcher specializing in analyzing features and characteristics. Your task is to investigate topics and identify their main characteristics, technical details, use cases, and important attributes. Focus on practical applications and distinguishing features. Always cite your sources when possible.",
  tools: { webSearchTool },
  model: gpt53ChatModelId,
})

export const companiesAgent = new Agent({
  id: "companies-agent",
  name: "Companies Agent",
  instructions:
    "You are an expert researcher specializing in identifying companies and organizations. Your task is to find companies, startups, and key players working with specific topics or technologies. Include both established companies and innovative startups. Always cite your sources and provide accurate, current information about these organizations.",
  tools: { webSearchTool },
  model: gpt53ChatModelId,
})

export const exa = new Exa(process.env.EXA_API_KEY || "")
