import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { cappedStderr, extractAudio, hasVideoStream, mergeAudioVideo, spawnWithTimeout } from '../../../utils/ffmpeg';
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { createTool } from '@mastra/core/tools';
import z, { success } from 'zod';
import { sanitizePath, WORKSPACE_PATH } from '../../../workspace';


function normalizeAudioOnly(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
      "-i", inputPath,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-y",
      outputPath
    ]);

    const stderr = cappedStderr(proc);

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg normalization failed with code ${code}.\n${stderr}`))
    });

    proc.on("error", (err) => reject(new Error("FFmpeg process error: " + err.message)));
  });
}

export const volumeNormalizerTool = createTool({
  id: "volume-normalizer",
  description: `Normalize the volume of an audio or video file using FFMPEG (loudnorm filter).
  
  Accepts one or more files. Files are processed sequentially. Output is saved with a _normalized suffix.

  Per-file behavior:
  - Video: Extracts audio, normalizes it, and merges it back into the video without re-encoding the video stream.
  - Audio: Normalizes it directly.`,
  inputSchema: z.object({
    files: z.array(z.string()).min(1).describe("Array of relative paths within the workspace for files to normalize"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    processed: z.number(),
    failed: z.number(),
    results: z.array(z.object({
      file: z.string(),
      output: z.string(),
      originalSize: z.number(),
      outputSize: z.number()
    })),
    errors: z.array(z.object({
      file: z.string(),
      error: z.string()
    }))
  }),

  execute: async ({ files }) => {
    const results = [];
    const errors = [];
    const tempDir = os.tmpdir();

    for (const filePath of files) {
      const relFile = sanitizePath(filePath);
      const srcPath = path.join(WORKSPACE_PATH, relFile);

      if (!fs.existsSync(srcPath)) {
        errors.push({ file: relFile, error: "File not found" });
        continue;
      }

      const originalSize = fs.statSync(srcPath).size;
      const ext = path.extname(relFile);
      const baseName = path.basename(relFile, ext);
      const outputRel = relFile.replace(ext, `_normalized${ext}`);
      const outputPath = path.join(WORKSPACE_PATH, outputRel);

      try {
        const isVideo = await hasVideoStream(srcPath);

        if (isVideo) {
          const tempAudio = path.join(tempDir, `${baseName}_temp_audio.mp3`);
          const tempNormAudio = path.join(tempDir, `${baseName}_temp_norm.mp3`);

          await extractAudio(srcPath, tempAudio);
          await normalizeAudioOnly(tempAudio, tempNormAudio);
          await mergeAudioVideo(srcPath, tempNormAudio, outputPath);

          if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio);
          if (fs.existsSync(tempNormAudio)) fs.unlinkSync(tempNormAudio);
        } else {
          await normalizeAudioOnly(srcPath, outputPath);
        }

        const outputSize = fs.statSync(outputPath).size;
        results.push({
          file: relFile,
          output: outputRel,
          originalSize,
          outputSize
        });
      } catch (err: any) {
        errors.push({ file: relFile, error: err.message });
      }
    }

    return {
      success: results.length > 0,
      processed: results.length,
      failed: errors.length,
      results,
      errors
    }
  } 
})