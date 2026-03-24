import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type temperatureChangeResult = {
  file: string
  value: number
  outputPath: string
}

function mapTemperatureToChannelGains(value: number): {
  redGain: number
  greenGain: number
  blueGain: number
} {
  const normalized = value / 100

  return {
    redGain: 1 + 0.22 * normalized,
    greenGain: 1 + 0.06 * normalized,
    blueGain: 1 - 0.22 * normalized,
  }
}

async function changeTemperature(
  imageBuffer: Buffer,
  value: number
): Promise<Buffer | errorResult> {
  try {
    const { redGain, greenGain, blueGain } = mapTemperatureToChannelGains(value)
    const metadata = await sharp(imageBuffer).metadata()
    const hasAlpha = metadata.hasAlpha === true
    const gains = hasAlpha
      ? [redGain, greenGain, blueGain, 1]
      : [redGain, greenGain, blueGain]
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

export const changeTemperatureTool = new Tool({
  id: "adjust-temperature",
  description: `Adjusts image temperature from cold to warm using per-channel RGB linear gains.

Use this tool when the user wants the image to look warmer/yellower or cooler/bluer.
This is a designer-friendly temperature scale:
- -100 to -40: Cold intense (blue cast)
- -39 to -10: Cold soft
- 0: Neutral (no change)
- 10 to 39: Warm soft
- 40 to 100: Warm intense (yellow cast)

Internal logic:
- Warm values increase red slightly and reduce blue slightly
- Cold values reduce red slightly and increase blue slightly
- Green is adjusted minimally for color balance

If user does not provide a value, ask for a temperature value from -100 to 100.

Output naming: Each processed image is saved with a suffix indicating the temperature.
- Cold values: "photo_cold25.jpg" (for value -25)
- Warm values: "photo_warm60.jpg" (for value 60)
This allows multiple temperature adjustments on the same image to coexist.

Processed images are saved to the "temperature_adjustment" folder.

Examples:
1. Warm look:
{"files": ["portrait.jpg"], "value": 35}
Output: "temperature_adjustment/portrait_warm35.jpg"

2. Cool look:
{"files": ["winter.jpg", "snow.png"], "value": -45}
Output: "temperature_adjustment/winter_cold45.jpg", "temperature_adjustment/snow_cold45.png"
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
        "Temperature value from -100 (cold/blue) to 100 (warm/yellow)."
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
    const results: Array<temperatureChangeResult> = []
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
          const result = await changeTemperature(buffer, value)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const tempLabel =
              value >= 0 ? `warm${value}` : `cold${Math.abs(value)}`
            const outputFileName = `${baseName}_${tempLabel}${ext}`
            const outputPath = `temperature_adjustment/${outputFileName}`
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
