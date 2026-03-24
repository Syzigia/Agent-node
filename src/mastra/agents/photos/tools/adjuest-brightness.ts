import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type brightnessChangeResult = {
  file: string
  value: number
  outputPath: string
}

async function changeBrightness(
  imageBuffer: Buffer,
  increase: boolean,
  percentage: number
): Promise<Buffer | errorResult> {
  try {
    const outpuBuffer = await sharp(imageBuffer)
      .modulate({
        brightness: increase ? 1 + percentage / 100 : 1 - percentage / 100,
      })
      .toBuffer()

    return outpuBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const changeBrightnessTool = new Tool({
  id: "change-brightness",
  description: `Adjusts the brightness of one or more images by a specified percentage.

    Increases or decreases the brightness of images based on a percentage value. The percentage indicates how much to adjust the brightness, where a positive value increases brightness and a negative value decreases it.
    Processed images are saved to the "brightness_adjustment" folder by default.
    
    Examples input:
    1. Single Image:
    {"files": ["photo.jpg"],
    "increase": true,
    "percentage": 20}
    
    2. Multiple Images:
    {        "files": ["photo1.jpg", "photo2.jpg"],
        "increase": false,
        "percentage": 10}
    `,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    increase: z
      .boolean()
      .describe(
        "A boolean indicating whether to increase (true) or decrease (false) the brightness."
      ),
    percentage: z
      .number()
      .describe(
        "A number representing the percentage by which to adjust the brightness."
      ),
  }),
  outputSchema: z.object({
    result: z.object({
      success: z.boolean(),
      processed: z.number(),
      failed: z.number(),
      skipped: z.number(),
      remaining: z.array(z.string()),
      results: z.array(
        z.object({
          file: z.string(),
          value: z.number(),
          outputPath: z.string(),
        })
      ),
      errors: z.array(
        z.object({
          file: z.string(),
          error: z.string(),
        })
      ),
    }),
  }),
  execute: async ({ files, increase, percentage }, context) => {
    const fs = getFilesystem(context)
    const results: Array<brightnessChangeResult> = []
    const errors: Array<errorResult> = []
    const skipped: Array<string> = []

    const limit = pLimit(CONCURRENCY)
    const start = Date.now()

    const promises = files.map((file) =>
      limit(async () => {
        if (Date.now() - start > BATCH_TIMEOUT_MS) {
          skipped.push(file)
          return
        }

        try {
          const exists = await fs.exists(file)
          if (!exists) {
            errors.push({ file, error: "File not found in S3" })
            return
          }

          const buffer = (await fs.readFile(file)) as Buffer
          const result = await changeBrightness(buffer, increase, percentage)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const outputPath = `brightness_adjustment/${fileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
              value: increase ? percentage : -percentage,
              outputPath,
            })
          } else {
            errors.push({ file, error: String(result.error) })
          }
        } catch (error) {
          errors.push({ file, error: (error as Error).message })
        }
      })
    )

    await Promise.all(promises)

    return {
      result: {
        success: results.length > 0,
        processed: results.length,
        failed: errors.length,
        skipped: skipped.length,
        remaining: skipped,
        results,
        errors,
      },
    }
  },
})
