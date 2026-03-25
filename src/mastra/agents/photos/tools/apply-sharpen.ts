import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type sharpenResult = {
  file: string
  sigma: number
  flat?: number
  jagged?: number
  outputPath: string
}

async function applySharpen(
  imageBuffer: Buffer,
  sigma: number,
  flat?: number,
  jagged?: number
): Promise<Buffer | errorResult> {
  try {
    let outputBuffer: Buffer

    if (flat !== undefined && jagged !== undefined) {
      // Use the 3-parameter signature: sharpen(sigma, flat, jagged)
      outputBuffer = await sharp(imageBuffer)
        .sharpen(sigma, flat, jagged)
        .toBuffer()
    } else if (flat !== undefined) {
      // Only flat provided
      outputBuffer = await sharp(imageBuffer).sharpen(sigma, flat).toBuffer()
    } else {
      // Just sigma
      outputBuffer = await sharp(imageBuffer).sharpen(sigma).toBuffer()
    }

    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const applySharpenTool = new Tool({
  id: "apply-sharpen",
  description: `Sharpens the image to enhance details and edges using unsharp mask.

Use this tool when the user wants to:
- Make an image sharper and more detailed
- Enhance edge definition
- Fix slightly soft or out-of-focus images
- Add clarity to details

Available parameters:
- sigma: number from 0.3 to 10 (default: 1.0)
  - 0.3-0.8: Subtle sharpening (minimal noise, good for portraits)
  - 1.0-1.5: Standard sharpening (recommended for most photos)
  - 2.0-3.0: Strong sharpening (for very soft images)
  - 3.1-10: Aggressive sharpening (may introduce artifacts)

- flat: number from 0 to 1 (optional)
  - Controls sharpening in flat/smooth areas
  - Lower values = less sharpening in smooth areas (less noise)
  - Higher values = more sharpening everywhere

- jagged: number from 0 to 1 (optional)
  - Controls sharpening along jagged/irregular edges
  - Higher values = sharper edges but may look artificial

Technical note: Uses sharp's sharpen() which implements unsharp mask filtering. The sigma parameter controls the gaussian blur radius used in the mask.

Output naming: Each processed image is saved with a suffix indicating the sigma value.
- "photo_sharpen1.jpg" (for sigma 1.0)
- "photo_sharpen2.5.jpg" (for sigma 2.5)

Processed images are saved to the "sharpen" folder.

Examples:
1. Standard sharpening:
{"files": ["photo.jpg"], "sigma": 1.0}
Output: "sharpen/photo_sharpen1.jpg"

2. Strong sharpening with edge control:
{"files": ["landscape.jpg"], "sigma": 2.0, "jagged": 0.5}
Output: "sharpen/landscape_sharpen2.jpg"

3. Subtle sharpening for portrait:
{"files": ["portrait.jpg"], "sigma": 0.8, "flat": 0.2}
Output: "sharpen/portrait_sharpen0.8.jpg"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    sigma: z
      .number()
      .min(0.3)
      .max(10)
      .default(1.0)
      .describe(
        "Sharpening intensity from 0.3 (subtle) to 10 (aggressive). Default 1.0."
      ),
    flat: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Flat area sharpening control (0-1). Optional. Lower = less noise in smooth areas."
      ),
    jagged: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Jagged edge sharpening control (0-1). Optional. Higher = sharper edges."
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
          flat: z.number().optional(),
          jagged: z.number().optional(),
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
  execute: async ({ files, sigma, flat, jagged }, context) => {
    const fs = getFilesystem(context)
    const results: Array<sharpenResult> = []
    const errors: Array<errorResult> = []
    const skipped: Array<string> = []

    // Sigma has a default value, so it should never be undefined
    const effectiveSigma = sigma ?? 1.0

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
          const result = await applySharpen(
            buffer,
            effectiveSigma,
            flat,
            jagged
          )

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const sigmaStr = effectiveSigma.toString().replace(".", "_")
            const outputFileName = `${baseName}_sharpen${sigmaStr}${ext}`
            const outputPath = `sharpen/${outputFileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
              sigma: effectiveSigma,
              flat,
              jagged,
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
