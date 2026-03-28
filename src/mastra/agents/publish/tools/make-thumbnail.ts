import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import * as path from "path"
import * as fs from "fs"
import type { ToolExecutionContext } from "@mastra/core/tools"
import { sanitizePath } from "../../../workspace"
import {
  getFilesystem,
  createTempWorkspace,
  uploadToS3,
  cleanupTempWorkspace,
  ensureLocalFile,
} from "../../../workspace/context"

const OUTPUT_FOLDER = "thumbnails"
const MODEL = "google/gemini-3.1-flash-image-preview"
const API_URL = "https://openrouter.ai/api/v1/chat/completions"

const ASPECT_RATIOS = ["16:9", "9:16"] as const

function fileToDataUri(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  }
  const mime = mimeMap[ext] ?? "image/jpeg"
  const buffer = fs.readFileSync(filePath)
  return `data:${mime};base64,${buffer.toString("base64")}`
}

function extractBase64Image(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/)
  if (!match) throw new Error("Invalid data URL from OpenRouter")
  return { mime: match[1]!, buffer: Buffer.from(match[2]!, "base64") }
}

async function callOpenRouter(
  apiKey: string,
  prompt: string,
  imageDataUris: string[],
  aspectRatio: string,
  imageSize: string
): Promise<string> {
  const content: any[] = [
    { type: "text", text: prompt },
    ...imageDataUris.map((uri) => ({
      type: "image_url" as const,
      image_url: { url: uri },
    })),
  ]

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: aspectRatio,
        image_size: imageSize,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenRouter ${response.status}: ${text}`)
  }

  const json = await response.json()
  const images = json.choices?.[0]?.message?.images
  if (!images || images.length === 0) {
    const textContent = json.choices?.[0]?.message?.content
    throw new Error(
      `No image returned from OpenRouter. Response: ${textContent ?? JSON.stringify(json)}`
    )
  }

  return images[0].image_url.url as string
}

export const makeThumbnailTool = createTool({
  id: "make-thumbnail",
  description: `Generates thumbnail variants (16:9 and 9:16) from one or more input images using AI image editing.
Requires at least one base image from the workspace — cannot generate from scratch.
Always produces TWO variants: landscape (16:9) and portrait (9:16).`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .min(1)
      .describe("Workspace paths of the base images to edit"),
    prompt: z
      .string()
      .min(1)
      .describe("Description of how to transform the images into thumbnails"),
    resolution: z
      .enum(["1K", "2K", "4K"])
      .optional()
      .default("2K")
      .describe("Output resolution (default: 2K)"),
  }),
  execute: async (
    { files, prompt, resolution },
    context: ToolExecutionContext
  ) => {
    const filesystem = getFilesystem(context)
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return {
        success: false,
        generated: 0,
        failed: ASPECT_RATIOS.length,
        results: [],
        errors: [{ aspectRatio: "all", error: "OPENROUTER_API_KEY not set" }],
      }
    }

    const tempDir = createTempWorkspace()

    try {
      const dataUris: string[] = []
      for (const rawFile of files) {
        const relFile = sanitizePath(rawFile)
        const { localPath } = await ensureLocalFile(
          filesystem,
          relFile,
          tempDir
        )
        dataUris.push(fileToDataUri(localPath))
      }

      const baseName = path.basename(files[0]!, path.extname(files[0]!))
      const imageSize = resolution ?? "2K"

      const predictions = await Promise.all(
        ASPECT_RATIOS.map(async (aspectRatio) => {
          const imageDataUrl = await callOpenRouter(
            apiKey,
            prompt,
            dataUris,
            aspectRatio,
            imageSize
          )
          return { aspectRatio, imageDataUrl }
        })
      )

      const results: Array<{ aspectRatio: string; savedTo: string }> = []
      const errors: Array<{ aspectRatio: string; error: string }> = []

      for (const { aspectRatio, imageDataUrl } of predictions) {
        try {
          const { buffer: imageBuffer } = extractBase64Image(imageDataUrl)
          const suffix = aspectRatio === "16:9" ? "16x9" : "9x16"
          const fileName = `${baseName}_${suffix}.png`
          const wsPath = `${OUTPUT_FOLDER}/${fileName}`
          const localPath = path.join(tempDir, fileName)

          const dir = path.dirname(localPath)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
          fs.writeFileSync(localPath, imageBuffer)

          await uploadToS3(filesystem, localPath, wsPath)

          results.push({ aspectRatio, savedTo: wsPath })
        } catch (err: any) {
          errors.push({ aspectRatio, error: err.message })
        }
      }

      return {
        success: results.length > 0,
        generated: results.length,
        failed: errors.length,
        results,
        errors,
      }
    } catch (err: any) {
      return {
        success: false,
        generated: 0,
        failed: ASPECT_RATIOS.length,
        results: [],
        errors: [{ aspectRatio: "all", error: err.message }],
      }
    } finally {
      cleanupTempWorkspace(tempDir)
    }
  },
})
