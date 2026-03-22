import * as path from "path"
import * as fs from "fs"
import { createTool } from "@mastra/core/tools"
import z from "zod"
import type { ToolExecutionContext } from "@mastra/core/tools"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import {
  cappedStderr,
  extractAudio,
  hasVideoStream,
  mergeAudioVideo,
  spawnWithTimeout,
} from "../../../utils/ffmpeg"
import { sanitizePath } from "../../../workspace"
import {
  getFilesystem,
  createTempWorkspace,
  ensureLocalFile,
  uploadToS3,
  cleanupTempWorkspace,
} from "../../../workspace/context"

function normalizeAudioOnly(
  inputPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
      "-i",
      inputPath,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-y",
      outputPath,
    ])

    const stderr = cappedStderr(proc)

    proc.on("close", (code) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `FFmpeg normalization failed with code ${code}.\n${stderr.get()}`
          )
        )
    })

    proc.on("error", (err) =>
      reject(new Error("FFmpeg process error: " + err.message))
    )
  })
}

export const volumeNormalizerTool = createTool({
  id: "volume-normalizer",
  description: `Normalize the volume of an audio or video file using FFMPEG (loudnorm filter).
  
  Accepts one or more files. Files are processed sequentially. Output is saved with a _normalized suffix.

  Per-file behavior:
  - Video: Extracts audio, normalizes it, and merges it back into the video without re-encoding the video stream.
  - Audio: Normalizes it directly.`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .min(1)
      .describe(
        "Array of relative paths within the workspace for files to normalize"
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    processed: z.number(),
    failed: z.number(),
    results: z.array(
      z.object({
        file: z.string(),
        output: z.string(),
        originalSize: z.number(),
        outputSize: z.number(),
      })
    ),
    errors: z.array(
      z.object({
        file: z.string(),
        error: z.string(),
      })
    ),
  }),

  execute: async ({ files }, context: ToolExecutionContext) => {
    const filesystem = getFilesystem(context)
    const results = []
    const errors = []

    for (const filePath of files) {
      const tempDir = createTempWorkspace()

      try {
        const relFile = sanitizePath(filePath)

        // Check if file exists in S3
        const exists = await filesystem.exists(relFile)
        if (!exists) {
          errors.push({ file: relFile, error: "File not found in workspace" })
          continue
        }

        // Download from S3
        const { localPath: srcPath, size: originalSize } =
          await ensureLocalFile(filesystem, relFile, tempDir)

        const ext = path.extname(relFile)
        const baseName = path.basename(relFile, ext)
        const outputRel = relFile.replace(ext, `_normalized${ext}`)
        const localOutputPath = path.join(tempDir, path.basename(outputRel))

        const isVideo = await hasVideoStream(srcPath)

        if (isVideo) {
          const tempAudio = path.join(tempDir, `${baseName}_temp_audio.mp3`)
          const tempNormAudio = path.join(tempDir, `${baseName}_temp_norm.mp3`)

          await extractAudio(srcPath, tempAudio)
          await normalizeAudioOnly(tempAudio, tempNormAudio)
          await mergeAudioVideo(srcPath, tempNormAudio, localOutputPath)
        } else {
          await normalizeAudioOnly(srcPath, localOutputPath)
        }

        // Upload to S3
        await uploadToS3(filesystem, localOutputPath, outputRel)

        // Get output size
        const outputContent = await filesystem.readFile(outputRel)
        const outputSize = outputContent.length

        results.push({
          file: relFile,
          output: outputRel,
          originalSize,
          outputSize,
        })
      } catch (err: any) {
        errors.push({ file: filePath, error: err.message })
      } finally {
        cleanupTempWorkspace(tempDir)
      }
    }

    return {
      success: results.length > 0,
      processed: results.length,
      failed: errors.length,
      results,
      errors,
    }
  },
})
