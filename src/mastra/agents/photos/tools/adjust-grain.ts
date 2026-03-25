import sharp from "sharp"
import { errorResult } from "./types"
import { Tool } from "@mastra/core/tools"
import z from "zod"
import { getFilesystem } from "@/src/mastra/workspace/context"
import pLimit from "p-limit"

const CONCURRENCY = 5
const BATCH_TIMEOUT_MS = 240_000

type grainChangeResult = {
  file: string
  intensity: number
  outputPath: string
}

// Genera un número aleatorio con distribución gaussiana (método Box-Muller)
function gaussianRandom(): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

// Genera una capa de ruido gaussiano en escala de grises
async function generateGrainLayer(
  width: number,
  height: number,
  intensity: number
): Promise<Buffer> {
  // Crear buffer RGBA
  const channels = 4
  const buffer = Buffer.alloc(width * height * channels)

  // Factor de intensidad (0-100) convertido a desviación estándar
  // Rango: 0-0.15 (para no saturar completamente)
  const intensityFactor = (intensity / 100) * 0.15

  for (let i = 0; i < width * height; i++) {
    const idx = i * channels

    // Generar ruido gaussiano
    let noise = gaussianRandom() * intensityFactor

    // Limitar el ruido para evitar valores extremos
    noise = Math.max(-0.5, Math.min(0.5, noise))

    // Convertir a valor de gris (128 = neutro)
    // El ruido se aplica alrededor del gris medio
    const grayValue = Math.round(128 + noise * 255)

    // RGB = gris (escala de grises)
    buffer[idx] = grayValue // R
    buffer[idx + 1] = grayValue // G
    buffer[idx + 2] = grayValue // B
    buffer[idx + 3] = 255 // A (opaco)
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

async function applyGrain(
  imageBuffer: Buffer,
  intensity: number
): Promise<Buffer | errorResult> {
  try {
    if (intensity === 0) {
      // Sin efecto, devolver imagen original
      return imageBuffer
    }

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

    // Generar capa de grano
    const grainLayer = await generateGrainLayer(width, height, intensity)

    // Componer: imagen original + capa de grano con blend overlay
    const outputBuffer = await sharp(imageBuffer)
      .composite([
        {
          input: grainLayer,
          blend: "overlay",
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

export const adjustGrainTool = new Tool({
  id: "adjust-grain",
  description: `Adds film grain/noise for a cinematic or analog film look.

Use this tool when the user wants to create a film-like texture, simulate high-ISO film, add cinematic atmosphere, or hide compression artifacts.

Available intensity values (0 to 100):
- 0: No effect
- 20-40: Subtle grain (discreet analog look, good for portraits)
- 50-70: Moderate grain (standard cinematic look)
- 80-100: Strong grain (high-ISO 3200 film, very textured)

Technical note: Generates a grayscale Gaussian noise layer using Box-Muller transform and composites it over the original image using 'overlay' blend mode for realistic film grain effect.

If user does not provide a value, ask: "What grain intensity would you like? 0 for no effect, 20-40 for subtle grain, 50-70 for moderate cinematic look, 80-100 for strong high-ISO film effect."

Output naming: Each processed image is saved with a suffix indicating the intensity.
- "photo_grain30.jpg" (for intensity 30)
- "photo_grain60.jpg" (for intensity 60)
This allows multiple grain intensities on the same image to coexist.

Processed images are saved to the "grain_adjustment" folder.

Examples:
1. Subtle analog look:
{"files": ["portrait.jpg"], "intensity": 35}
Output: "grain_adjustment/portrait_grain35.jpg"

2. Cinematic film look:
{"files": ["movie-scene.jpg", "landscape.png"], "intensity": 55}
Output: "grain_adjustment/movie-scene_grain55.jpg", "grain_adjustment/landscape_grain55.png"

3. High-ISO dramatic effect:
{"files": ["night-photo.jpg"], "intensity": 85}
Output: "grain_adjustment/night-photo_grain85.jpg"
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
        "Grain intensity from 0 (no effect) to 100 (strong high-ISO film). 20-40 is subtle, 50-70 moderate, 80-100 strong."
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
    const results: Array<grainChangeResult> = []
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
          const result = await applyGrain(buffer, intensity)

          if (Buffer.isBuffer(result)) {
            const fileName = file.split("/").pop() || file
            const ext = fileName.includes(".")
              ? `.${fileName.split(".").pop()}`
              : ""
            const baseName = fileName.replace(ext, "")
            const outputFileName = `${baseName}_grain${intensity}${ext}`
            const outputPath = `grain_adjustment/${outputFileName}`
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
