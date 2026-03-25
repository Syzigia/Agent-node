import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type lutResult = {
  file: string
  lutFile: string
  outputPath: string
}

// LUT Types
interface CubeLUT {
  title: string
  type: "1D" | "3D"
  size: number
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  data: [number, number, number][]
}

// Parse .cube LUT file from filesystem
async function parseCubeLUT(filePath: string, fs: any): Promise<CubeLUT> {
  const rawContent = await fs.readFile(filePath, "utf8")
  // Ensure content is a string (filesystem may return Buffer)
  const content = Buffer.isBuffer(rawContent)
    ? rawContent.toString("utf8")
    : rawContent
  const lines = content
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l && !l.startsWith("#"))

  const lut: Partial<CubeLUT> = {
    title: "",
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data: [],
  }

  for (const line of lines) {
    if (line.startsWith("TITLE")) {
      lut.title = line.replace("TITLE", "").trim().replace(/"/g, "")
    } else if (line.startsWith("LUT_1D_SIZE")) {
      lut.type = "1D"
      lut.size = parseInt(line.split(/\s+/)[1])
    } else if (line.startsWith("LUT_3D_SIZE")) {
      lut.type = "3D"
      lut.size = parseInt(line.split(/\s+/)[1])
    } else if (line.startsWith("DOMAIN_MIN")) {
      const [, r, g, b] = line.split(/\s+/).map(Number)
      lut.domainMin = [r, g, b]
    } else if (line.startsWith("DOMAIN_MAX")) {
      const [, r, g, b] = line.split(/\s+/).map(Number)
      lut.domainMax = [r, g, b]
    } else {
      // Data points: lines with 3 float numbers
      const parts = line.split(/\s+/).map(Number)
      if (parts.length === 3 && parts.every((n: number) => !isNaN(n))) {
        lut.data!.push([parts[0], parts[1], parts[2]])
      }
    }
  }

  if (!lut.type || !lut.size) {
    throw new Error("Invalid LUT: missing LUT_1D_SIZE or LUT_3D_SIZE")
  }

  return lut as CubeLUT
}

// Linear interpolation
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Apply 3D LUT with trilinear interpolation
function applyLUT3D(
  lut: CubeLUT,
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const { size, data, domainMin, domainMax } = lut
  const scale = size - 1

  // Normalize to LUT domain
  const nr = (r - domainMin[0]) / (domainMax[0] - domainMin[0])
  const ng = (g - domainMin[1]) / (domainMax[1] - domainMin[1])
  const nb = (b - domainMin[2]) / (domainMax[2] - domainMin[2])

  // Vertex indices
  const ri = Math.min(Math.floor(nr * scale), scale - 1)
  const gi = Math.min(Math.floor(ng * scale), scale - 1)
  const bi = Math.min(Math.floor(nb * scale), scale - 1)

  // Fractions for interpolation
  const rf = nr * scale - ri
  const gf = ng * scale - gi
  const bf = nb * scale - bi

  // Index in data array (order: R → G → B)
  const idx = (b: number, g: number, r: number) =>
    r + g * size + b * size * size

  const c000 = data[idx(bi, gi, ri)]
  const c001 = data[idx(bi, gi, ri + 1)]
  const c010 = data[idx(bi, gi + 1, ri)]
  const c011 = data[idx(bi, gi + 1, ri + 1)]
  const c100 = data[idx(bi + 1, gi, ri)]
  const c101 = data[idx(bi + 1, gi, ri + 1)]
  const c110 = data[idx(bi + 1, gi + 1, ri)]
  const c111 = data[idx(bi + 1, gi + 1, ri + 1)]

  // Trilinear interpolation per channel
  const interp = (channel: number) =>
    lerp(
      lerp(
        lerp(c000[channel], c001[channel], rf),
        lerp(c010[channel], c011[channel], rf),
        gf
      ),
      lerp(
        lerp(c100[channel], c101[channel], rf),
        lerp(c110[channel], c111[channel], rf),
        gf
      ),
      bf
    )

  return [interp(0), interp(1), interp(2)]
}

// Apply 1D LUT with linear interpolation
function applyLUT1D(
  lut: CubeLUT,
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const { size, data } = lut
  const scale = size - 1

  const lookup = (value: number, channel: number): number => {
    const idx = Math.min(value * scale, scale - 1)
    const lo = Math.floor(idx)
    const hi = lo + 1
    const t = idx - lo
    return lerp(data[lo][channel], data[hi][channel], t)
  }

  return [lookup(r, 0), lookup(g, 1), lookup(b, 2)]
}

// Apply LUT to image buffer
async function applyLUTToBuffer(
  imageBuffer: Buffer,
  lut: CubeLUT
): Promise<Buffer | errorResult> {
  try {
    // Read image as raw pixels (preserving alpha if present)
    const { data, info } = await sharp(imageBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const hasAlpha = info.channels === 4
    const channels = info.channels

    // Apply LUT pixel by pixel
    const output = Buffer.allocUnsafe(data.length)
    const applyFn = lut.type === "3D" ? applyLUT3D : applyLUT1D

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255

      const [newR, newG, newB] = applyFn(lut, r, g, b)

      output[i] = Math.round(Math.min(1, Math.max(0, newR)) * 255)
      output[i + 1] = Math.round(Math.min(1, Math.max(0, newG)) * 255)
      output[i + 2] = Math.round(Math.min(1, Math.max(0, newB)) * 255)

      // Preserve alpha channel if present
      if (hasAlpha) {
        output[i + 3] = data[i + 3]
      }
    }

    // Return as raw buffer that can be converted back to original format
    return output
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const applyLutTool = new Tool({
  id: "apply-lut",
  description: `Applies a color grading LUT (Look-Up Table) from a .cube file to images.

Use this tool when the user wants to:
- Apply color grading/correction to photos
- Apply cinematic looks or film emulation
- Match colors between different cameras
- Create stylized color effects

Available parameters:
- files: array of image file paths
- lutFile: path to the .cube LUT file

LUT file formats supported:
- 1D LUT: simpler color curves (one-dimensional)
- 3D LUT: complex color transformations (three-dimensional, more common)

Technical note: Parses the .cube file and applies trilinear interpolation for 3D LUTs or linear interpolation for 1D LUTs. Supports images with alpha channel (transparency is preserved).

Processed images are saved to the "lut_applied" folder with the original format preserved.

Output naming: Each processed image is saved with "_lut" suffix before the extension.
- "photo_lut.jpg" (from photo.jpg)
- "landscape_lut.png" (from landscape.png)

Examples:
1. Apply cinematic LUT to photos:
{"files": ["photo1.jpg", "photo2.png"], "lutFile": "cinematic.cube"}
Output: "lut_applied/photo1_lut.jpg", "lut_applied/photo2_lut.png"

2. Apply film emulation LUT:
{"files": ["raw.jpg"], "lutFile": "film-emulation.cube"}
Output: "lut_applied/raw_lut.jpg"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    lutFile: z
      .string()
      .describe("Path to the .cube LUT file to apply to the images."),
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
          lutFile: z.string(),
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
  execute: async ({ files, lutFile }, context) => {
    const fs = getFilesystem(context)
    const results: Array<lutResult> = []
    const errors: Array<errorResult> = []
    const skipped: Array<string> = []

    // Parse LUT once and reuse for all images
    let lut: CubeLUT
    try {
      const lutExists = await fs.exists(lutFile)
      if (!lutExists) {
        return {
          result: {
            success: false,
            processed: 0,
            failed: files.length,
            skipped: 0,
            remaining: [],
            results: [],
            errors: files.map((file) => ({
              file,
              error: `LUT file not found: ${lutFile}`,
            })),
          },
        }
      }
      lut = await parseCubeLUT(lutFile, fs)
    } catch (error) {
      return {
        result: {
          success: false,
          processed: 0,
          failed: files.length,
          skipped: 0,
          remaining: [],
          results: [],
          errors: files.map((file) => ({
            file,
            error: `Failed to parse LUT file: ${error}`,
          })),
        },
      }
    }

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
            errors.push({ file, error: "File not found" })
            return
          }

          const buffer = (await fs.readFile(file)) as Buffer

          // Get original format info
          const metadata = await sharp(buffer).metadata()
          const originalFormat = metadata.format

          const result = await applyLUTToBuffer(buffer, lut)

          if (Buffer.isBuffer(result)) {
            // Build output filename preserving original extension
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const outputFileName = `${baseName}_lut${ext}`
            const outputPath = `lut_applied/${outputFileName}`

            // Reconstruct image with original format
            const outputBuffer = await sharp(result, {
              raw: {
                width: metadata.width || 0,
                height: metadata.height || 0,
                channels: metadata.hasAlpha ? 4 : 3,
              },
            })
              .toFormat(originalFormat as keyof sharp.FormatEnum)
              .toBuffer()

            await fs.writeFile(outputPath, outputBuffer)
            results.push({
              file,
              lutFile,
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
