import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type blurResult = {
  file: string
  sigma: number
  outputPath: string
}

async function applyBlur(
  imageBuffer: Buffer,
  sigma: number
): Promise<Buffer | errorResult> {
  try {
    const outputBuffer = await sharp(imageBuffer).blur(sigma).toBuffer()
    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const applyBlurTool = new Tool({
  id: "apply-blur",
  description: `Applies gaussian blur to soften the image.

Use this tool when the user wants to:
- Soften an image or reduce sharpness
- Create a bokeh/background blur effect
- Reduce noise or artifacts
- Create a dreamy or ethereal look
- Blur backgrounds for privacy

Available parameters:
- sigma: number from 0.3 to 100
  - 0.3-1.0: Very subtle blur (slight softness)
  - 1.0-3.0: Light blur (soft focus effect, good for portraits)
  - 3.0-8.0: Moderate blur (noticeable softness, dreamy look)
  - 8.0-15.0: Strong blur (heavy softness, background blur)
  - 15.0+: Extreme blur (very abstract, bokeh-like)

Technical note: Uses sharp's blur() which applies a gaussian blur with the specified sigma radius. Higher sigma = more blur.

Output naming: Each processed image is saved with a suffix indicating the blur radius.
- "photo_blur1.jpg" (for sigma 1.0)
- "photo_blur5.jpg" (for sigma 5.0)

Processed images are saved to the "blur" folder.

Examples:
1. Light soft focus for portrait:
{"files": ["portrait.jpg"], "sigma": 2.0}
Output: "blur/portrait_blur2.jpg"

2. Moderate blur for dreamy effect:
{"files": ["landscape.jpg"], "sigma": 5.0}
Output: "blur/landscape_blur5.jpg"

3. Heavy blur for background effect:
{"files": ["background.jpg"], "sigma": 10.0}
Output: "blur/background_blur10.jpg"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    sigma: z
      .number()
      .min(0.3)
      .max(100)
      .describe(
        "Blur radius from 0.3 (subtle) to 100 (extreme). Recommended: 1-5 for light, 5-15 for moderate, 15+ for strong."
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
          sigma: z.number(),
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
  execute: async ({ files, sigma }, context) => {
    const fs = getFilesystem(context)
    const results: Array<blurResult> = []
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
          const result = await applyBlur(buffer, sigma)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const sigmaStr = sigma.toString().replace(".", "_")
            const outputFileName = `${baseName}_blur${sigmaStr}${ext}`
            const outputPath = `blur/${outputFileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
              sigma,
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
