import { createWorkflow, createStep } from "@mastra/core/workflows"
import * as fs from "fs"
import * as path from "path"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import { spawn } from "child_process"
import { z } from "zod"

import { sanitizePath } from "../workspace"
import {
  getFilesystem,
  createTempWorkspace,
  ensureLocalFile,
  uploadToS3,
  cleanupTempWorkspace,
  resolveS3MediaPath,
} from "../workspace/context"
import {
  getMediaDuration,
  hasVideoStream,
  detectSilences,
  type SilenceSegment,
} from "../utils/ffmpeg"

// ─── Shared types ─────────────────────────────────────────────────────────────

const silenceSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  duration: z.number(),
})

function applySegmentCuts(
  inputPath: string,
  outputPath: string,
  silences: SilenceSegment[],
  totalDuration: number,
  isVideo: boolean,
  padding: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("[applySegmentCuts] Starting...")
    console.log("[applySegmentCuts] Input:", inputPath)
    console.log("[applySegmentCuts] Output:", outputPath)
    console.log("[applySegmentCuts] Silences:", silences.length)
    console.log("[applySegmentCuts] Is video:", isVideo)

    // Build segments to KEEP (invert the silences)
    const paddedSilences = silences
      .map((s) => ({
        start: Math.max(0, s.start + padding),
        end: Math.min(totalDuration, s.end - padding),
      }))
      .filter((s) => s.end > s.start)

    const keep: Array<{ start: number; end: number }> = []
    let cursor = 0
    for (const silence of paddedSilences) {
      if (silence.start > cursor + 0.01)
        keep.push({ start: cursor, end: silence.start })
      cursor = silence.end
    }
    if (cursor < totalDuration - 0.01)
      keep.push({ start: cursor, end: totalDuration })

    const n = keep.length
    console.log("[applySegmentCuts] Segments to keep:", n)

    if (n === 0) {
      console.error("[applySegmentCuts] ERROR: No segments to keep")
      reject(new Error("No segments to keep after applying cuts"))
      return
    }

    const filterParts: string[] = []
    const concatInputs: string[] = []

    for (let i = 0; i < n; i++) {
      const segment = keep[i]
      if (!segment) continue
      const { start, end } = segment
      if (isVideo) {
        filterParts.push(
          `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`
        )
        filterParts.push(
          `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
        )
        concatInputs.push(`[v${i}][a${i}]`)
      } else {
        filterParts.push(
          `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
        )
        concatInputs.push(`[a${i}]`)
      }
    }

    const suffix = isVideo
      ? `concat=n=${n}:v=1:a=1[vout][aout]`
      : `concat=n=${n}:v=0:a=1[aout]`
    filterParts.push(`${concatInputs.join("")}${suffix}`)
    const mapArgs = isVideo
      ? ["-map", "[vout]", "-map", "[aout]"]
      : ["-map", "[aout]"]

    // M10: Specify codecs — filter_complex requires re-encoding
    const codecArgs = isVideo
      ? [
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "18",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
        ]
      : ["-c:a", "aac", "-b:a", "192k"]

    const args = [
      "-i",
      inputPath,
      "-filter_complex",
      filterParts.join(";"),
      ...mapArgs,
      ...codecArgs,
      "-y",
      outputPath,
    ]

    console.log("[applySegmentCuts] Running ffmpeg...")
    console.log(
      "[applySegmentCuts] Command:",
      ffmpegInstaller.path,
      args.join(" ")
    )

    const proc = spawn(ffmpegInstaller.path, args)
    let stderr = ""
    proc.stderr.on("data", (d) => {
      stderr += d.toString()
    })
    proc.on("close", (code) => {
      console.log("[applySegmentCuts] ffmpeg exited with code:", code)
      if (code === 0) {
        console.log("[applySegmentCuts] ffmpeg completed successfully")
        resolve()
      } else {
        console.error(
          "[applySegmentCuts] ffmpeg error (code",
          code,
          "):",
          stderr.slice(-800)
        )
        reject(new Error(`ffmpeg error (code ${code}):\n${stderr.slice(-800)}`))
      }
    })
    proc.on("error", (err) => {
      console.error("[applySegmentCuts] ffmpeg error:", err)
      reject(err)
    })
  })
}

// ─── Step 1: Detect silences ──────────────────────────────────────────────────

const detectStep = createStep({
  id: "detect-silences",
  description: "Analyzes the file and detects silence segments",
  inputSchema: z.object({
    file: z.string().describe("Relative path within the workspace"),
    noiseThresholdDb: z.number().min(-60).max(-10).default(-30),
    minSilenceDuration: z.number().min(0.1).max(10).default(0.5),
  }),
  outputSchema: z.object({
    file: z.string(),
    fileType: z.enum(["video", "audio"]),
    totalDuration: z.number(),
    segments: z.array(silenceSegmentSchema),
    totalSilenceSeconds: z.number(),
    summary: z.string(),
    tempDir: z.string(),
  }),
  execute: async ({ inputData, requestContext }) => {
    console.log("[detectStep] Starting silence detection...")
    console.log("[detectStep] Input:", JSON.stringify(inputData, null, 2))

    const filesystem = getFilesystem({ requestContext })
    const tempDir = createTempWorkspace()

    try {
      const { noiseThresholdDb, minSilenceDuration } = inputData
      const file = sanitizePath(inputData.file)

      // Resolve the file path (with fuzzy matching)
      const { resolvedPath } = await resolveS3MediaPath(filesystem, file)
      console.log("[detectStep] Resolved path:", resolvedPath)

      // Download from S3 to local temp
      const { localPath } = await ensureLocalFile(
        filesystem,
        resolvedPath,
        tempDir
      )
      console.log("[detectStep] Local path:", localPath)

      try {
        const [totalDuration, isVideo] = await Promise.all([
          getMediaDuration(localPath),
          hasVideoStream(localPath),
        ])

        // Pass totalDuration so trailing silences are captured (H6)
        const segments = await detectSilences(
          localPath,
          noiseThresholdDb,
          minSilenceDuration,
          totalDuration
        )

        console.log("[detectStep] Duration:", totalDuration)
        console.log("[detectStep] Is video:", isVideo)
        console.log("[detectStep] Segments found:", segments.length)

        const totalSilenceSeconds = parseFloat(
          segments
            .reduce((acc: number, s: SilenceSegment) => acc + s.duration, 0)
            .toFixed(2)
        )

        const summary = [
          `File: ${resolvedPath} (${isVideo ? "video" : "audio"})`,
          `Total duration: ${totalDuration.toFixed(1)}s`,
          `Silences found: ${segments.length}`,
          `Time to be removed: ${totalSilenceSeconds}s (${(totalSilenceSeconds / 60).toFixed(1)} min)`,
          ``,
          `Segments:`,
          ...segments.map(
            (s: SilenceSegment, i: number) =>
              `  [${i + 1}] ${s.start}s -> ${s.end}s (${s.duration}s)`
          ),
        ].join("\n")

        console.log("[detectStep] Detection completed successfully")

        return {
          file: resolvedPath,
          fileType: isVideo ? ("video" as const) : ("audio" as const),
          totalDuration: parseFloat(totalDuration.toFixed(2)),
          segments,
          totalSilenceSeconds,
          summary,
          tempDir,
        }
      } finally {
        // Don't cleanup yet - we might need the file for the cut step
        // Cleanup happens in cutStep or if error
      }
    } catch (error) {
      // Cleanup on error
      cleanupTempWorkspace(tempDir)
      throw error
    }
  },
})

// ─── Step 2: HITL checkpoint — Mastra native suspend() ───────────────────────

const approvalStep = createStep({
  id: "human-approval",
  description: "Pauses for the human to review and approve the detected cuts",
  inputSchema: z.object({
    file: z.string(),
    fileType: z.enum(["video", "audio"]),
    totalDuration: z.number(),
    segments: z.array(silenceSegmentSchema),
    totalSilenceSeconds: z.number(),
    summary: z.string(),
    tempDir: z.string(),
  }),
  // What the Studio shows while the workflow is paused
  suspendSchema: z.object({
    message: z.string(),
    summary: z.string(),
    segments: z.array(silenceSegmentSchema),
  }),
  // What the human provides to resume
  resumeSchema: z.object({
    approved: z.boolean().describe("true = apply cuts, false = cancel"),
    preserveNaturalPauses: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    file: z.string(),
    fileType: z.enum(["video", "audio"]),
    totalDuration: z.number(),
    segments: z.array(silenceSegmentSchema),
    approved: z.boolean(),
    preserveNaturalPauses: z.boolean(),
    tempDir: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    console.log("[approvalStep] Starting approval step...")
    console.log("[approvalStep] Has resumeData:", !!resumeData)

    // If the human has not decided yet -> pause and show data
    if (!resumeData) {
      console.log("[approvalStep] No resumeData, suspending workflow...")
      console.log("[approvalStep] Segments to show:", inputData.segments.length)
      await suspend({
        message:
          "Review the detected silences and confirm whether to apply the cuts.",
        summary: inputData.summary,
        segments: inputData.segments,
      })
      // This return is never reached when suspended,
      // but TypeScript requires it for the outputSchema
      console.log(
        "[approvalStep] WARNING: This code should not execute after suspend()"
      )
      return {
        file: inputData.file,
        fileType: inputData.fileType,
        totalDuration: inputData.totalDuration,
        segments: inputData.segments,
        approved: false,
        preserveNaturalPauses: true,
        tempDir: inputData.tempDir,
      }
    }

    // The human responded — pass the decision to the next step
    console.log(
      "[approvalStep] Resuming with data:",
      JSON.stringify(resumeData, null, 2)
    )
    return {
      file: inputData.file,
      fileType: inputData.fileType,
      totalDuration: inputData.totalDuration,
      segments: inputData.segments,
      approved: resumeData.approved,
      preserveNaturalPauses: resumeData.preserveNaturalPauses ?? true,
      tempDir: inputData.tempDir,
    }
  },
})

// ─── Step 3: Apply cuts (only if approved = true) ────────────────────────────

const cutStep = createStep({
  id: "apply-cuts",
  description: "Applies the approved cuts to the file",
  inputSchema: z.object({
    file: z.string(),
    fileType: z.enum(["video", "audio"]),
    totalDuration: z.number(),
    segments: z.array(silenceSegmentSchema),
    approved: z.boolean(),
    preserveNaturalPauses: z.boolean(),
    tempDir: z.string(),
  }),
  outputSchema: z.object({
    skipped: z.boolean(),
    output: z.string().optional(),
    secondsRemoved: z.number().optional(),
    originalDuration: z.number().optional(),
    newDuration: z.number().optional(),
    message: z.string(),
  }),
  execute: async ({ inputData, requestContext }) => {
    console.log("[cutStep] Starting cut application...")
    console.log(
      "[cutStep] Input:",
      JSON.stringify(
        {
          file: inputData.file,
          approved: inputData.approved,
          segmentsCount: inputData.segments.length,
        },
        null,
        2
      )
    )

    const filesystem = getFilesystem({ requestContext })
    const {
      file,
      fileType,
      totalDuration,
      segments,
      approved,
      preserveNaturalPauses,
      tempDir,
    } = inputData

    try {
      if (!approved) {
        console.log("[cutStep] Approval denied, returning skipped")
        cleanupTempWorkspace(tempDir)
        return { skipped: true, message: "Cuts cancelled by the user." }
      }

      // Ensure local file exists (it should from detectStep)
      const { localPath: inputPath } = await ensureLocalFile(
        filesystem,
        file,
        tempDir
      )

      const ext = path.extname(file)
      const outputRel = `${file.replace(ext, "")}_cut${ext}`
      const outputPath = path.join(tempDir, path.basename(outputRel))

      console.log("[cutStep] Input path:", inputPath)
      console.log("[cutStep] Output path:", outputPath)

      // Verify input file exists
      if (!fs.existsSync(inputPath)) {
        console.error("[cutStep] ERROR: Input file not found:", file)
        throw new Error(`Input file not found: ${file}`)
      }
      console.log("[cutStep] Input file found")

      const padding = preserveNaturalPauses ? 0.1 : 0

      // Apply the cuts
      console.log("[cutStep] Calling applySegmentCuts...")
      try {
        await applySegmentCuts(
          inputPath,
          outputPath,
          segments,
          totalDuration,
          fileType === "video",
          padding
        )
        console.log("[cutStep] applySegmentCuts completed")
      } catch (error: any) {
        console.error("[cutStep] ERROR in applySegmentCuts:", error.message)
        throw new Error(`Error processing the file: ${error.message}`)
      }

      // Verify output file was created
      console.log("[cutStep] Verifying output file...")
      if (!fs.existsSync(outputPath)) {
        console.error(
          "[cutStep] ERROR: Output file was not generated:",
          outputRel
        )
        throw new Error(
          `Output file was not generated: ${outputRel}. Check that ffmpeg has write permissions.`
        )
      }
      console.log("[cutStep] Output file exists")

      const outputStats = fs.statSync(outputPath)
      if (outputStats.size === 0) {
        console.error("[cutStep] ERROR: Output file is empty:", outputRel)
        fs.unlinkSync(outputPath) // Clean up empty file
        throw new Error(`Output file is empty: ${outputRel}`)
      }
      console.log("[cutStep] Output file size:", outputStats.size, "bytes")

      // Upload result to S3
      console.log("[cutStep] Uploading result to S3...")
      await uploadToS3(filesystem, outputPath, outputRel)
      console.log("[cutStep] Upload completed")

      // M14: Account for padding when computing actual time removed.
      // Each silence is shrunk by `padding` from both sides, so the actual
      // time removed per segment is `duration - 2 * padding` (clamped >= 0).
      const actualRemoved = parseFloat(
        segments
          .reduce((acc: number, s: SilenceSegment) => {
            const effectiveCut = Math.max(0, s.duration - 2 * padding)
            return acc + effectiveCut
          }, 0)
          .toFixed(2)
      )
      console.log("[cutStep] Time removed:", actualRemoved, "seconds")

      console.log("[cutStep] Completed successfully")
      return {
        skipped: false,
        output: outputRel,
        secondsRemoved: actualRemoved,
        originalDuration: totalDuration,
        newDuration: parseFloat((totalDuration - actualRemoved).toFixed(2)),
        message: `Done. ${outputRel} generated (${(outputStats.size / 1024 / 1024).toFixed(2)} MB). Removed ${actualRemoved}s (${(actualRemoved / 60).toFixed(1)} min).`,
      }
    } finally {
      // Cleanup temp workspace
      cleanupTempWorkspace(tempDir)
    }
  },
})

// ─── Final workflow ───────────────────────────────────────────────────────────

export const silenceCutterWorkflow = createWorkflow({
  id: "silence-cutter",
  description:
    "Detects silences in an audio/video file, pauses for human approval, and applies the cuts.",
  inputSchema: z.object({
    file: z
      .string()
      .describe("Relative path within the workspace (e.g. wild_project.mp4)"),
    noiseThresholdDb: z.number().min(-60).max(-10).optional().default(-30),
    minSilenceDuration: z.number().min(0.1).max(10).optional().default(0.5),
  }),
  outputSchema: z.object({
    skipped: z.boolean(),
    output: z.string().optional(),
    secondsRemoved: z.number().optional(),
    originalDuration: z.number().optional(),
    newDuration: z.number().optional(),
    message: z.string(),
  }),
})
  .then(detectStep)
  .then(approvalStep)
  .then(cutStep)
  .commit()
