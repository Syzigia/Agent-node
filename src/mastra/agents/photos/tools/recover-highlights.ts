import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type highlightRecoveryResult = {
  file: string
  value: number
  outputPath: string
}

// Mapea valor 0-100 a ganancia del canal L en Lab.
// 0 -> 1.00 (sin cambio), 100 -> 0.65 (oscurecido fuerte)
function mapHighlightValueToLuminanceGain(value: number): number {
  return 1 - (value / 100) * 0.35
}

// Aplica curva de recuperación de luces en el canal L de Lab
async function recoverHighlightsLab(
  imageBuffer: Buffer,
  value: number
): Promise<Buffer | errorResult> {
  try {
    const luminanceGain = mapHighlightValueToLuminanceGain(value)
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

export const recoverHighlightsTool = new Tool({
  id: "recover-highlights",
  description: `Recovers detail in bright/overexposed areas (highlights) of one or more images using professional Lab color space processing.

This tool darkens highlight areas to reveal detail that was "blown out" or overexposed. It works by:
1. Converting the image to Lab color space (separates luminance from color)
2. Applying a luminance curve to the L (lightness) channel to darken highlights
3. Recombining channels and converting back to sRGB

Use this when the user wants to "fix overexposed areas", "recover highlights", or "see detail in bright areas like skies, windows, or skin".

Available values (0-100):
- 0-30: "Subtle" - Slightly softens highlights, natural look
- 31-60: "Moderate" - Recovers detail in skies, skin highlights, good balance
- 61-85: "Intense" - Recovers detail in windows, clouds, dramatic effect
- 86-100: "Aggressive" - Darkens highlights significantly, may look artificial

If the user doesn't specify a value, ask: "What level of highlight recovery would you like?
- 0-30 for subtle softening
- 31-60 for moderate recovery (recommended)
- 61-85 for intense recovery
- 86-100 for aggressive recovery"

Processed images are saved to the "highlight_recovery" folder.

Examples:
1. Single image with moderate recovery:
{"files": ["photo.jpg"], "value": 50}

2. Multiple images with intense recovery:
{"files": ["bright1.jpg", "bright2.jpg"], "value": 70}
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
        "Highlight recovery strength from 0 to 100. Higher values recover more detail but may darken the image too much."
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
    const results: Array<highlightRecoveryResult> = []
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
          const result = await recoverHighlightsLab(buffer, value)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const outputPath = `highlight_recovery/${fileName}`
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
