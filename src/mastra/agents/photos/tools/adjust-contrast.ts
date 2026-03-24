import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type contrastChangeResult = {
  file: string
  value: number
  outputPath: string
}

async function changeContrast(
  imageBuffer: Buffer,
  value: number
): Promise<Buffer | errorResult> {
  try {
    // Map -100 to 100 range to multiplier (0.0 to 2.0)
    // 0 = no change (multiplier 1.0), -100 = minimum (0.0), 100 = maximum (2.0)
    const multiplier = 1 + value / 100

    const outputBuffer = await sharp(imageBuffer).linear(multiplier).toBuffer()

    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const changeContrastTool = new Tool({
  id: "adjust-contrast",
  description: `Adjusts the contrast of one or more images by a specified value.

    Increases or decreases the contrast of images based on a value between -100 and 100.
    Positive values increase contrast (more intense, more difference between light and dark areas).
    Negative values decrease contrast (more muted, less difference between light and dark areas).
    Zero (0) means no change.
    Processed images are saved to the "contrast_adjustment" folder by default.
    
    Examples input:
    1. Single Image - Increase contrast:
    {"files": ["photo.jpg"],
    "value": 50}
    
    2. Multiple Images - Decrease contrast:
    {"files": ["photo1.jpg", "photo2.jpg"],
    "value": -30}
    
    3. Maximum contrast:
    {"files": ["photo.jpg"],
    "value": 100}
    `,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    value: z
      .number()
      .min(-100)
      .max(100)
      .describe(
        "A number between -100 and 100 representing the contrast adjustment. Positive values increase contrast, negative values decrease contrast."
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
  execute: async ({ files, value }, context) => {
    const fs = getFilesystem(context)
    const results: Array<contrastChangeResult> = []
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
          const result = await changeContrast(buffer, value)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const outputPath = `contrast_adjustment/${fileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
              value,
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
