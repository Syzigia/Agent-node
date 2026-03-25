import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type vignetteChangeResult = {
  file: string
  intensity: number
  outputPath: string
}

// Genera un buffer de imagen con gradiente radial para vignette
// Centro transparente, bordes negros con alpha basado en intensidad
async function generateVignetteGradient(
  width: number,
  height: number,
  intensity: number
): Promise<Buffer> {
  // Crear buffer RGBA
  const channels = 4
  const buffer = Buffer.alloc(width * height * channels)

  const centerX = width / 2
  const centerY = height / 2
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY)

  // Factor de intensidad (0-100) convertido a rango de alpha (0-0.7)
  // Max 0.7 para no hacer completamente negros los bordes
  const intensityFactor = (intensity / 100) * 0.7

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels

      // Distancia al centro normalizada (0-1)
      const distanceX = x - centerX
      const distanceY = y - centerY
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY)
      const normalizedDistance = distance / maxDistance

      // Aplicar curva suave (cuadrado para transición más gradual)
      const alpha = Math.pow(normalizedDistance, 2) * intensityFactor * 255

      // RGB = 0 (negro), A = alpha calculado
      buffer[idx] = 0 // R
      buffer[idx + 1] = 0 // G
      buffer[idx + 2] = 0 // B
      buffer[idx + 3] = Math.min(255, Math.max(0, Math.round(alpha))) // A
    }
  }

  // Convertir buffer raw a PNG usando sharp
  return sharp(buffer, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer()
}

async function applyVignette(
  imageBuffer: Buffer,
  intensity: number
): Promise<Buffer | errorResult> {
  try {
    // Obtener dimensiones de la imagen
    const metadata = await sharp(imageBuffer).metadata()
    const width = metadata.width || 0
    const height = metadata.height || 0

    if (width === 0 || height === 0) {
      return {
        file: "buffer",
        error: "Could not determine image dimensions",
      }
    }

    // Generar capa de vignette
    const vignetteLayer = await generateVignetteGradient(
      width,
      height,
      intensity
    )

    // Componer: imagen original + capa de vignette con blend multiply
    const outputBuffer = await sharp(imageBuffer)
      .composite([
        {
          input: vignetteLayer,
          blend: "multiply",
        },
      ])
      .toBuffer()

    return outputBuffer
  } catch (error) {
    return {
      file: "buffer",
      error,
    }
  }
}

export const adjustVignetteTool = new Tool({
  id: "adjust-vignette",
  description: `Applies a vignette effect that darkens the edges of the image to draw attention to the center.

Use this tool when the user wants to create focus on the center of the image, add a cinematic look, or create a vintage atmosphere.

Available intensity values (0 to 100):
- 0: No effect
- 30-50: Soft vignette (recommended for portraits, subtle effect)
- 60-80: Moderate vignette (visible effect, good for landscapes)
- 90-100: Strong vignette (dramatic cinematic effect)

Technical note: Creates a radial gradient overlay (transparent center to dark edges) and composites it over the original image using multiply blend mode.

If user does not provide a value, ask: "What vignette intensity would you like? 0 for no effect, 30-50 for soft (recommended for portraits), 60-80 for moderate, 90-100 for strong dramatic effect."

Output naming: Each processed image is saved with a suffix indicating the intensity.
- "photo_vignette40.jpg" (for intensity 40)
- "photo_vignette80.jpg" (for intensity 80)
This allows multiple vignette intensities on the same image to coexist.

Processed images are saved to the "vignette_adjustment" folder.

Examples:
1. Soft vignette for portrait:
{"files": ["portrait.jpg"], "intensity": 40}
Output: "vignette_adjustment/portrait_vignette40.jpg"

2. Strong cinematic vignette:
{"files": ["landscape.jpg", "movie-scene.png"], "intensity": 75}
Output: "vignette_adjustment/landscape_vignette75.jpg", "vignette_adjustment/movie-scene_vignette75.png"
`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .describe("An array of file paths to the images to be processed."),
    intensity: z
      .number()
      .min(0)
      .max(100)
      .describe(
        "Vignette intensity from 0 (no effect) to 100 (strong dark edges). 30-50 is soft, 60-80 moderate, 90-100 strong."
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
          intensity: z.number(),
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
  execute: async ({ files, intensity }, context) => {
    const fs = getFilesystem(context)
    const results: Array<vignetteChangeResult> = []
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
          const result = await applyVignette(buffer, intensity)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const outputFileName = `${baseName}_vignette${intensity}${ext}`
            const outputPath = `vignette_adjustment/${outputFileName}`
            await fs.writeFile(outputPath, result)
            results.push({
              file,
              intensity,
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
