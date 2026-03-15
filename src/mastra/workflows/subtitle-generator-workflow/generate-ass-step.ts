import { createStep } from "@mastra/core/workflows";
import * as fs from "fs";
import * as path from "path";
import z from "zod";

import { getVideoDimensions, hasVideoStream } from "../../utils/ffmpeg";
import { sanitizePath, WORKSPACE_PATH } from "../../workspace";
import { buildTikTokAss } from "./tiktok-ass";

const assWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

const assSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
});

export const generateAssStep = createStep({
  id: "generate-ass-step",
  description: "Generates an .ass subtitle file with karaoke-ready timing tags",
  inputSchema: z.object({
    words: z.array(assWordSchema),
    segments: z.array(assSegmentSchema),
    fullText: z.string(),
    language: z.string(),
    chunksProcessed: z.number(),
  }),
  outputSchema: z.object({
    words: z.array(assWordSchema),
    segments: z.array(assSegmentSchema),
    fullText: z.string(),
    language: z.string(),
    chunksProcessed: z.number(),
    assPath: z.string(),
    assLines: z.number(),
  }),
  execute: async ({ inputData, getInitData }) => {
    const initData = getInitData() as { filePath?: unknown } | undefined;
    const rawFilePath = typeof initData?.filePath === "string" ? initData.filePath : "subtitles.ass";
    const relPath = sanitizePath(rawFilePath);
    const parsed = path.parse(relPath);
    const subtitleDirRel = "subtitle_file";
    const assRel = path.join(subtitleDirRel, `${parsed.name}.ass`);
    const assAbs = path.join(WORKSPACE_PATH, assRel);

    const sourceAbsPath = path.join(WORKSPACE_PATH, relPath);
    const videoMeta = await hasVideoStream(sourceAbsPath)
      .then(async (isVideo) => {
        if (!isVideo) return { width: 1080, height: 1920 };
        const dims = await getVideoDimensions(sourceAbsPath);
        return dims;
      })
      .catch(() => ({ width: 1080, height: 1920 }));

    const { assContent, assLines } = buildTikTokAss({
      title: parsed.name || "Subtitles",
      words: inputData.words,
      textCase: "original",
      layoutMode: "two-lines",
      animationPreset: "tiktok-pop",
      videoWidth: videoMeta.width,
      videoHeight: videoMeta.height,
    });

    if (!fs.existsSync(path.dirname(assAbs))) {
      fs.mkdirSync(path.dirname(assAbs), { recursive: true });
    }
    fs.writeFileSync(assAbs, assContent, "utf8");

    console.log(`[generate-ass-step] Wrote ${assLines} lines to ${assAbs}`);

    return {
      ...inputData,
      assPath: assRel,
      assLines,
    };
  },
});
