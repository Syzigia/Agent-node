import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type saturationChangeResult = {
  file: string
  value: number
  outputPath: string
}

async function changeSaturation(
  imageBuffer: Buffer,
  value: number
): Promise<Buffer | errorResult> {
  try {
    // value: 0-200, convertimos a multiplicador (0-2.0)
    const saturationMultiplier = value / 100

    const outputBuffer = await sharp(imageBuffer)
      .modulate({ saturation: saturationMultiplier })
      .toBuffer()

    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const changeSaturationTool = new Tool({
  id: "adjust-saturation",
  description: `Adjusts image saturation from black and white to highly saturated colors.

Use this tool when the user wants to make colors more vivid or more muted.
This applies uniform saturation adjustment to all colors equally.

Available values (0 to 200):
- 0: Black and white (completely desaturated)
- 50: Very muted colors
- 100: Original (no change)
- 150: More vivid colors
- 200: Highly saturated/explosive colors

If user does not provide a value, ask: "What saturation level would you like? 0 for black and white, 50-90 for muted, 100 for original, 110-150 for vivid, 160-200 for highly saturated."

Output naming: Each processed image is saved with a suffix indicating the saturation value.
- "photo_saturation50.jpg" (for value 50)
- "photo_saturation150.jpg" (for value 150)
This allows multiple saturation adjustments on the same image to coexist.

Processed images are saved to the "saturation_adjustment" folder.

Examples:
1. Black and white:
{"files": ["portrait.jpg"], "value": 0}
Output: "saturation_adjustment/portrait_saturation0.jpg"

2. Boost colors:
{"files": ["landscape.jpg", "flowers.png"], "value": 140}
Output: "saturation_adjustment/landscape_saturation140.jpg", "saturation_adjustment/flowers_saturation140.png"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    value: z
      .number()
      .min(0)
      .max(200)
      .describe(
        "Saturation value from 0 (black and white) to 200 (highly saturated). 100 is the original."
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
    const results: Array<saturationChangeResult> = []
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
          const result = await changeSaturation(buffer, value)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const outputFileName = `${baseName}_saturation${value}${ext}`
            const outputPath = `saturation_adjustment/${outputFileName}`
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
