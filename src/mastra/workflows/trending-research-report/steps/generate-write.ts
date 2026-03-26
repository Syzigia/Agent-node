import { createStep } from "@mastra/core/workflows"
import z from "zod"
import { writerAgent } from "../agent"

export const generateWriteStep = createStep({
  id: "generate-write",
  inputSchema: z.object({
    definition: z.string(),
    characteristics: z.string(),
    companies: z.string(),
    trends: z.string(),
  }),
  outputSchema: z.object({
    topic: z.string(),
    subtitles: z.array(z.string()),
    contents: z.array(z.string()),
  }),
  execute: async ({ inputData, getInitData }) => {
    const { topic } = getInitData<{ topic: string }>()

    const prompt = `
        You are an expert writer. Your job is to write a new, well-crafted document.

        You are provided with 4 texts as SOURCES OF INFORMATION, not as content to copy.
        Read them, understand the information they contain, and then write from scratch.

        The document should be about: ${topic}

        --- SOURCE 1 (Definition) ---
        ${inputData.definition}

        --- SOURCE 2 (Characteristics) ---
        ${inputData.characteristics}

        --- SOURCE 3 (Companies) ---
        ${inputData.companies}

        --- SOURCE 4 (Design Trends) ---
        ${inputData.trends}

        Your task:
        - Extract important ideas, data, and concepts from the 4 sources
        - Define between 3 and 6 topics that structure the document well
        - For each topic, WRITE new content in your own words
        - The text should flow naturally, as if written by an expert human
        - Do not copy phrases from the sources. Use the information, not the words
        - Each section should have sufficient development (minimum 3-4 sentences)
        - Consider design trends and practical applications for designers

        Respond ONLY with valid JSON, without backticks or extra text:

        {
        "subtitles": ["Section title 1", "Section title 2", ...],
        "contents": ["Newly written text for section 1...", "Newly written text for section 2...", ...]
        }
        `.trim()

    const result = await writerAgent.generate(prompt)

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error("No JSON found in the response")
      }

      const parsed = JSON.parse(jsonMatch[0])

      return {
        topic,
        subtitles: parsed.subtitles,
        contents: parsed.contents,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to parse JSON from writerAgent response: ${errorMessage}. Original response: ${result.text}`
      )
    }
  },
})
