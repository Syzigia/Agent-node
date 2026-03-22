import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import sharp from "sharp"
import type { ToolExecutionContext } from "@mastra/core/tools"
import { sanitizePath } from "../../../workspace"
import {
  getFilesystem,
  createTempWorkspace,
  ensureLocalFile,
  uploadToS3,
  cleanupTempWorkspace,
} from "../../../workspace/context"

export const convertToWebpTool = createTool({
  id: "convert-to-webp",
  description: `Converts a list of images to WebP, generating COPIES. Originals are NEVER modified or deleted.
First use list_files to get exact paths, then pass all the files you want to convert in a single call.
Examples:
- One image:    { files: ["photo.jpg"] }
- Multiple:     { files: ["img/banner.png", "img/hero.jpg", "logo.png"] }
- With quality: { files: ["photo.jpg"], quality: 90 }`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .min(1)
      .describe(
        "Array of relative paths within the workspace for files to convert"
      ),
    quality: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(85)
      .describe("WebP quality from 1 to 100 (default: 85)"),
  }),
  execute: async ({ files, quality }, context: ToolExecutionContext) => {
    const filesystem = getFilesystem(context)
    const results: Array<{
      original: string
      webp: string
      sizeOriginal: number
      sizeWebp: number
      reduction: string
    }> = []
    const errors: Array<{ file: string; error: string }> = []

    for (const rawFile of files) {
      const tempDir = createTempWorkspace()

      try {
        const relFile = sanitizePath(rawFile)

        // Check if file exists in S3
        const exists = await filesystem.exists(relFile)
        if (!exists) {
          errors.push({ file: relFile, error: "File not found in workspace" })
          continue
        }

        // Skip if already webp
        const ext = path.extname(relFile).toLowerCase()
        if (ext === ".webp") {
          errors.push({
            file: relFile,
            error: "File is already .webp, skipped to avoid overwriting",
          })
          continue
        }

        const webpRel = relFile.replace(/\.[^.]+$/, ".webp")

        // Download from S3
        const { localPath: srcPath } = await ensureLocalFile(
          filesystem,
          relFile,
          tempDir
        )
        const localDestPath = path.join(tempDir, path.basename(webpRel))

        // Convert
        await sharp(srcPath).webp({ quality }).toFile(localDestPath)

        // Upload to S3
        await uploadToS3(filesystem, localDestPath, webpRel)

        // Get sizes
        const originalContent = await filesystem.readFile(relFile)
        const webpContent = await filesystem.readFile(webpRel)
        const sizeOriginal = originalContent.length
        const sizeWebp = webpContent.length
        const reduction = (
          ((sizeOriginal - sizeWebp) / sizeOriginal) *
          100
        ).toFixed(1)

        results.push({
          original: relFile,
          webp: webpRel,
          sizeOriginal,
          sizeWebp,
          reduction: `${reduction}%`,
        })
      } catch (err: any) {
        errors.push({ file: rawFile, error: err.message })
      } finally {
        cleanupTempWorkspace(tempDir)
      }
    }

    return {
      success: results.length > 0,
      converted: results.length,
      failed: errors.length,
      results,
      errors,
    }
  },
})
