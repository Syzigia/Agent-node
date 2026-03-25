import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type sepiaResult = {
  file: string
  outputPath: string
}

// Matriz de recombinación estándar para efecto sepia
const SEPIA_MATRIX: [
  [number, number, number],
  [number, number, number],
  [number, number, number],
] = [
  [0.3588, 0.7044, 0.1368],
  [0.299, 0.587, 0.114],
  [0.2392, 0.4696, 0.0912],
]

async function applySepia(imageBuffer: Buffer): Promise<Buffer | errorResult> {
  try {
    const outputBuffer = await sharp(imageBuffer)
      .recomb(SEPIA_MATRIX)
      .toBuffer()
    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const applySepiaTool = new Tool({
  id: "apply-sepia",
  description: `Applies a sepia filter for a vintage/brownish look.

Use this tool when the user wants to create a vintage, old photograph, or brownish tone effect.

Technical note: Uses sharp's recomb() operation with a standard 3x3 sepia matrix transformation.

Processed images are saved to the "sepia" folder.

Example:
{"files": ["photo.jpg"]}
Output: "basic_filters/photo_sepia.jpg"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
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
  execute: async ({ files }, context) => {
    const fs = getFilesystem(context)
    const results: Array<sepiaResult> = []
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
          const result = await applySepia(buffer)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const outputFileName = `${baseName}_sepia${ext}`
            const outputPath = `sepia/${outputFileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
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
