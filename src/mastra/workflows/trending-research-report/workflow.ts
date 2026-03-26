import { createWorkflow } from "@mastra/core/workflows"
import z from "zod"
import { searchTrending } from "../trending-research/workflow"
import { generateWriteStep } from "./steps/generate-write"

export const trandingResearchReportWorkflow = createWorkflow({
  id: "trending-research-report",
  inputSchema: z.object({
    topic: z.string().describe("The topic to research"),
  }),
  outputSchema: z.object({
    topic: z.string(),
    subtitles: z.array(z.string()),
    contents: z.array(z.string()),
  }),
})
  .then(searchTrending)
  .then(generateWriteStep)
  .commit()
