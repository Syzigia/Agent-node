import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type tintChangeResult = {
  file: string
  value: number
  outputPath: string
}

// Mapea valor -100 a 100 a ganancia del canal verde
// -100 → 0.75 (menos verde = más magenta)
// 0 → 1.00 (sin cambio)
// +100 → 1.25 (más verde)
function mapTintToGreenGain(value: number): number {
  return 1 + (value / 100) * 0.25
}

async function changeTint(
  imageBuffer: Buffer,
  value: number
): Promise<Buffer | errorResult> {
  try {
    const greenGain = mapTintToGreenGain(value)
    const metadata = await sharp(imageBuffer).metadata()
    const hasAlpha = metadata.hasAlpha === true

    // Ajustamos solo el canal verde (índice 1 en RGB)
    // RGB: [R, G, B] o RGBA: [R, G, B, A]
    const gains = hasAlpha
      ? [1, greenGain, 1, 1] // RGBA: dejamos R, B, A sin cambio
      : [1, greenGain, 1] // RGB: dejamos R, B sin cambio
    const offsets = hasAlpha ? [0, 0, 0, 0] : [0, 0, 0]

    const outputBuffer = await sharp(imageBuffer)
      .linear(gains, offsets)
      .toBuffer()

    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const changeTintTool = new Tool({
  id: "adjust-tint",
  description: `Adjusts image tint from magenta to green using per-channel RGB linear gains on the green channel.

Use this tool when the user wants to correct green color casts (e.g., from fluorescent lighting) or add magenta/green tones.
This is the perpendicular axis to temperature - while temperature adjusts blue/yellow, tint adjusts magenta/green.

Available values (-100 to 100):
- -100 to -40: Magenta intense (removes green, adds magenta cast)
- -39 to -10: Magenta soft
- 0: Neutral (no change)
- 10 to 39: Green soft
- 40 to 100: Green intense (adds green cast)

Internal logic:
- Negative values reduce the green channel (creating magenta tones)
- Positive values increase the green channel
- Red and blue channels remain unchanged

If user does not provide a value, ask: "What tint adjustment would you like? -100 to -40 for magenta intense, -39 to -10 for magenta soft, 0 for neutral, 10-39 for green soft, 40-100 for green intense."

Output naming: Each processed image is saved with a suffix indicating the tint value.
- Negative values: "photo_tint-50.jpg" (for value -50)
- Positive values: "photo_tint30.jpg" (for value 30)
This allows multiple tint adjustments on the same image to coexist.

Processed images are saved to the "tint_adjustment" folder.

Examples:
1. Remove green cast from fluorescent lighting:
{"files": ["office-portrait.jpg"], "value": -30}
Output: "tint_adjustment/office-portrait_tint-30.jpg"

2. Add green tint for creative effect:
{"files": ["forest.jpg", "nature.png"], "value": 45}
Output: "tint_adjustment/forest_tint45.jpg", "tint_adjustment/nature_tint45.png"
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
        "Tint value from -100 (magenta) to 100 (green). Negative values remove green/add magenta, positive values add green."
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
    const results: Array<tintChangeResult> = []
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
          const result = await changeTint(buffer, value)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const tintLabel = value >= 0 ? `tint${value}` : `tint${value}`
            const outputFileName = `${baseName}_${tintLabel}${ext}`
            const outputPath = `tint_adjustment/${outputFileName}`
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
