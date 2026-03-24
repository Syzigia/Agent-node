import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type shadowRecoveryResult = {
  file: string
  value: number
  outputPath: string
}

// Mapea valor 0-100 a ganancia del canal L en Lab.
// 0 -> 1.00 (sin cambio), 100 -> 1.35 (aclarado fuerte)
function mapShadowValueToLuminanceGain(value: number): number {
  return 1 + (value / 100) * 0.35
}

// Aplica curva de recuperación de sombras en el canal L de Lab
async function recoverShadowsLab(
  imageBuffer: Buffer,
  value: number
): Promise<Buffer | errorResult> {
  try {
    const luminanceGain = mapShadowValueToLuminanceGain(value)
    const metadata = await sharp(imageBuffer).metadata()
    const hasAlpha = metadata.hasAlpha === true
    const channelGain = hasAlpha
      ? [luminanceGain, 1, 1, 1]
      : [luminanceGain, 1, 1]
    const channelOffset = hasAlpha ? [0, 0, 0, 0] : [0, 0, 0]

    const outputBuffer = await sharp(imageBuffer)
      .pipelineColourspace("lab")
      .linear(channelGain, channelOffset)
      .toColourspace("srgb")
      .toBuffer()

    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const recoverShadowsTool = new Tool({
  id: "recover-shadows",
  description: `Recovers detail in dark/shadow areas of one or more images using professional Lab color space processing.

This tool brightens shadow areas to reveal hidden details while preserving colors accurately. It works by:
1. Converting the image to Lab color space (separates luminance from color)
2. Applying a luminance curve to the L (lightness) channel to lift shadows
3. Recombining channels and converting back to sRGB

Available values (0-100):
- 0-30: "Subtle" - Lightly lifts shadows, minimal noise
- 31-60: "Moderate" - Recovers detail in deep shadows, good balance
- 61-85: "Intense" - Maximum shadow recovery, may add some noise
- 86-100: "Aggressive" - Lifts all shadows significantly, noticeable noise possible

If the user doesn't specify a value, ask: "What level of shadow recovery would you like? 
- 0-30 for subtle lifting
- 31-60 for moderate recovery (recommended)
- 61-85 for intense recovery
- 86-100 for aggressive recovery"

Processed images are saved to the "shadow_recovery" folder.

Examples:
1. Single image with moderate recovery:
{"files": ["photo.jpg"], "value": 50}

2. Multiple images with subtle recovery:
{"files": ["dark1.jpg", "dark2.jpg"], "value": 25}
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    value: z
      .number()
      .min(0)
      .max(100)
      .describe(
        "Shadow recovery strength from 0 to 100. Higher values recover more detail but may increase noise."
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
    const results: Array<shadowRecoveryResult> = []
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
          const result = await recoverShadowsLab(buffer, value)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const outputPath = `shadow_recovery/${fileName}`
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
