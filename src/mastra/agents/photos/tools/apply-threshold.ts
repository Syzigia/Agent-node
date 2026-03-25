import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type thresholdResult = {
  file: string
  threshold: number
  outputPath: string
}

async function applyThreshold(
  imageBuffer: Buffer,
  threshold: number
): Promise<Buffer | errorResult> {
  try {
    const outputBuffer = await sharp(imageBuffer)
      .threshold(threshold, { grayscale: false })
      .toBuffer()
    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const applyThresholdTool = new Tool({
  id: "apply-threshold",
  description: `Converts the image to pure black and white based on a threshold value.

Use this tool when the user wants to create a high-contrast black and white image, posterize, or apply a binary threshold effect.

Available parameters:
- threshold: number from 0 to 255 (default: 128)
  - Pixels with value >= threshold become white (255)
  - Pixels with value < threshold become black (0)
  - Lower values (0-100): More white, less black
  - Mid value (128): Balanced
  - Higher values (150-255): More black, less white

Technical note: Uses sharp's threshold() operation. Values >= threshold become white, values < threshold become black.

If user does not provide a threshold, ask: "What threshold value would you like? 0-255, where 128 is the middle (balanced). Lower values make more white, higher values make more black."

Processed images are saved to the "threshold" folder with suffix "_threshold{value}".

Examples:
1. Balanced threshold:
{"files": ["photo.jpg"], "threshold": 128}
Output: "basic_filters/photo_threshold128.jpg"

2. High contrast (more black):
{"files": ["drawing.jpg"], "threshold": 180}
Output: "basic_filters/drawing_threshold180.jpg"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    threshold: z
      .number()
      .min(0)
      .max(255)
      .describe(
        "Threshold value from 0 to 255. Pixels >= threshold become white, pixels < threshold become black. Default is 128."
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
          threshold: z.number(),
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
  execute: async ({ files, threshold }, context) => {
    const fs = getFilesystem(context)
    const results: Array<thresholdResult> = []
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
          const result = await applyThreshold(buffer, threshold)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const outputFileName = `${baseName}_threshold${threshold}${ext}`
            const outputPath = `threshold/${outputFileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
              threshold,
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
