import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type edgeDetectionResult = {
  file: string
  direction: string
  sensitivity: number
  outputPath: string
}

// Sobel kernels for edge detection (flattened 3x3 arrays)
const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1]

async function detectEdgesHorizontal(
  imageBuffer: Buffer,
  sensitivity: number
): Promise<Buffer | errorResult> {
  try {
    // Build pipeline: grayscale → convolve → normalize → [threshold] → png
    let pipeline = sharp(imageBuffer)
      .grayscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: SOBEL_X,
      })
      .normalize()

    // Apply threshold based on sensitivity if needed
    if (sensitivity > 0) {
      const threshold = Math.round((sensitivity / 100) * 255)
      pipeline = pipeline.threshold(threshold, { greyscale: true })
    }

    // Output as PNG
    const outputBuffer = await pipeline.png().toBuffer()
    return outputBuffer
  } catch (error) {
    return { file: "buffer", error }
  }
}

async function detectEdgesVertical(
  imageBuffer: Buffer,
  sensitivity: number
): Promise<Buffer | errorResult> {
  try {
    // Build pipeline: grayscale → convolve → normalize → [threshold] → png
    let pipeline = sharp(imageBuffer)
      .grayscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: SOBEL_Y,
      })
      .normalize()

    // Apply threshold based on sensitivity if needed
    if (sensitivity > 0) {
      const threshold = Math.round((sensitivity / 100) * 255)
      pipeline = pipeline.threshold(threshold, { greyscale: true })
    }

    // Output as PNG
    const outputBuffer = await pipeline.png().toBuffer()
    return outputBuffer
  } catch (error) {
    return { file: "buffer", error }
  }
}

async function detectEdgesCombined(
  imageBuffer: Buffer,
  sensitivity: number
): Promise<Buffer | errorResult> {
  try {
    // For combined edges, we'll apply both Sobel kernels separately and combine them
    // First, get the horizontal and vertical edge images
    const horizontalEdges = await sharp(imageBuffer)
      .grayscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: SOBEL_X,
      })
      .normalize()
      .raw()
      .toBuffer()

    const verticalEdges = await sharp(imageBuffer)
      .grayscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: SOBEL_Y,
      })
      .normalize()
      .raw()
      .toBuffer()

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata()
    const width = metadata.width || 0
    const height = metadata.height || 0

    if (width === 0 || height === 0) {
      return { file: "buffer", error: "Could not determine image dimensions" }
    }

    // Calculate magnitude: sqrt(Gx^2 + Gy^2)
    const magnitudeBuffer = Buffer.alloc(width * height)
    for (let i = 0; i < width * height; i++) {
      const gx = horizontalEdges[i]
      const gy = verticalEdges[i]
      const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy))
      magnitudeBuffer[i] = Math.round(magnitude)
    }

    // Create image from magnitude buffer and apply optional threshold
    let pipeline = sharp(magnitudeBuffer, {
      raw: { width, height, channels: 1 },
    }).normalize()

    if (sensitivity > 0) {
      const threshold = Math.round((sensitivity / 100) * 255)
      pipeline = pipeline.threshold(threshold, { greyscale: true })
    }

    const outputBuffer = await pipeline.png().toBuffer()
    return outputBuffer
  } catch (error) {
    return { file: "buffer", error }
  }
}

async function detectEdges(
  imageBuffer: Buffer,
  direction: "horizontal" | "vertical" | "combined",
  sensitivity: number
): Promise<Buffer | errorResult> {
  switch (direction) {
    case "horizontal":
      return detectEdgesHorizontal(imageBuffer, sensitivity)
    case "vertical":
      return detectEdgesVertical(imageBuffer, sensitivity)
    case "combined":
      return detectEdgesCombined(imageBuffer, sensitivity)
    default:
      return { file: "buffer", error: "Invalid direction" }
  }
}

export const detectEdgesTool = new Tool({
  id: "detect-edges",
  description: `Detects edges in the image using Sobel operator convolution with normalized contrast.

Use this tool when the user wants to:
- Detect and highlight edges in an image
- Create edge maps for artistic effects
- Analyze image structure and boundaries
- Create line drawings or sketches from photos
- Detect horizontal or vertical lines specifically

Available directions:
- horizontal: Detects vertical edges (edges running up-down)
  - Good for finding vertical lines, pillars, tree trunks
  
- vertical: Detects horizontal edges (edges running left-right)
  - Good for finding horizontal lines, horizons, shelves
  
- combined: Detects edges in all directions (magnitude of gradient)
  - Combines both horizontal and vertical detection
  - Recommended for general edge detection

Available sensitivity:
- 0: Full grayscale edge map (0-255 range, maximum detail)
- 10-30: Low sensitivity (only strongest edges, cleaner result)
- 31-60: Medium sensitivity (good balance)
- 61-100: High sensitivity (more edges detected, may have noise)

Technical note: Uses Sobel kernels with histogram normalization to ensure edges span the full 0-255 range for maximum visibility. When sensitivity > 0, applies threshold to create binary black/white edge map.

Output naming: Each processed image is saved with a suffix indicating the direction.
- "photo_edgesHorizontal.jpg" (horizontal detection)
- "photo_edgesVertical.jpg" (vertical detection)
- "photo_edgesCombined.jpg" (combined/magnitude)

Processed images are saved to the "edge_detection" folder.

Examples:
1. Detect all edges with full grayscale detail:
{"files": ["photo.jpg"], "direction": "combined", "sensitivity": 0}
Output: "edge_detection/photo_edgesCombined.jpg"

2. Find edges with medium sensitivity (cleaner):
{"files": ["photo.jpg"], "direction": "combined", "sensitivity": 40}
Output: "edge_detection/photo_edgesCombined.jpg"

3. Find vertical lines only:
{"files": ["architecture.jpg"], "direction": "horizontal", "sensitivity": 0}
Output: "edge_detection/architecture_edgesHorizontal.jpg"

4. Find horizontal lines with low sensitivity:
{"files": ["landscape.jpg"], "direction": "vertical", "sensitivity": 25}
Output: "edge_detection/landscape_edgesVertical.jpg"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    direction: z
      .enum(["horizontal", "vertical", "combined"])
      .describe(
        "Edge detection direction. 'horizontal' detects vertical edges, 'vertical' detects horizontal edges, 'combined' detects all edges."
      ),
    sensitivity: z
      .number()
      .min(0)
      .max(100)
      .default(0)
      .describe(
        "Edge sensitivity threshold. 0 for full grayscale detail (0-255). 1-100 for binary threshold where higher = more edges. Recommended: 0 for detail, 30-50 for cleaner binary edges."
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
          direction: z.string(),
          sensitivity: z.number(),
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
  execute: async ({ files, direction, sensitivity }, context) => {
    const fs = getFilesystem(context)
    const results: Array<edgeDetectionResult> = []
    const errors: Array<errorResult> = []
    const skipped: Array<string> = []

    // Ensure sensitivity has a default value
    const effectiveSensitivity = sensitivity ?? 0

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
          const result = await detectEdges(
            buffer,
            direction,
            effectiveSensitivity
          )

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const directionSuffix =
              direction.charAt(0).toUpperCase() + direction.slice(1)
            const outputFileName = `${baseName}_edges${directionSuffix}${ext}`
            const outputPath = `edge_detection/${outputFileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
              direction,
              sensitivity: effectiveSensitivity,
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
