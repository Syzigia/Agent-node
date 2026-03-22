import { createStep } from "@mastra/core/workflows"
import * as fs from "fs"
import * as path from "path"
import z from "zod"

import { getVideoDimensions, hasVideoStream } from "../../utils/ffmpeg"
import { sanitizePath } from "../../workspace"
import {
  getFilesystem,
  createTempWorkspace,
  ensureLocalFile,
  uploadToS3,
  cleanupTempWorkspace,
} from "../../workspace/context"
import { buildTikTokAss } from "./tiktok-ass"

const assWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
})

const assSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
})

export const generateAssStep = createStep({
  id: "generate-ass-step",
  description: "Generates an .ass subtitle file with karaoke-ready timing tags",
  inputSchema: z.object({
    words: z.array(assWordSchema),
    segments: z.array(assSegmentSchema),
    fullText: z.string(),
    language: z.string(),
    chunksProcessed: z.number(),
    sourceFilePath: z.string(),
  }),
  outputSchema: z.object({
    words: z.array(assWordSchema),
    segments: z.array(assSegmentSchema),
    fullText: z.string(),
    language: z.string(),
    chunksProcessed: z.number(),
    sourceFilePath: z.string(),
    assPath: z.string(),
    assLines: z.number(),
  }),
  execute: async ({ inputData, requestContext }) => {
    const filesystem = getFilesystem({ requestContext })
    const tempDir = createTempWorkspace()

    try {
      const rawFilePath = inputData.sourceFilePath
      const relPath = sanitizePath(rawFilePath)
      const parsed = path.parse(relPath)
      const subtitleDirRel = "subtitle_file"
      const assRel = path.join(subtitleDirRel, `${parsed.name}.ass`)
      const assLocalPath = path.join(tempDir, `${parsed.name}.ass`)

      // Get video dimensions from source file (downloaded to temp)
      const { localPath: sourceLocalPath } = await ensureLocalFile(
        filesystem,
        relPath,
        tempDir
      )
      const videoMeta = await hasVideoStream(sourceLocalPath)
        .then(async (isVideo) => {
          if (!isVideo) return { width: 1080, height: 1920 }
          const dims = await getVideoDimensions(sourceLocalPath)
          return dims
        })
        .catch(() => ({ width: 1080, height: 1920 }))

      const { assContent, assLines } = buildTikTokAss({
        title: parsed.name || "Subtitles",
        words: inputData.words,
        textCase: "original",
        layoutMode: "two-lines",
        animationPreset: "tiktok-pop",
        videoWidth: videoMeta.width,
        videoHeight: videoMeta.height,
      })

      // Ensure directory exists locally
      const assDir = path.dirname(assLocalPath)
      if (!fs.existsSync(assDir)) {
        fs.mkdirSync(assDir, { recursive: true })
      }
      fs.writeFileSync(assLocalPath, assContent, "utf8")

      // Upload to S3
      await uploadToS3(filesystem, assLocalPath, assRel)

      console.log(
        `[generate-ass-step] Wrote ${assLines} lines to S3: ${assRel}`
      )

      return {
        ...inputData,
        assPath: assRel,
        assLines,
      }
    } finally {
      cleanupTempWorkspace(tempDir)
    }
  },
})
