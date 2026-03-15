import { createStep } from "@mastra/core/workflows";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import z from "zod";

import { cappedStderr, getVideoDimensions, hasVideoStream, spawnWithTimeout } from "../../utils/ffmpeg";
import { sanitizePath, WORKSPACE_PATH } from "../../workspace";
import {
  buildTikTokAss,
  DEFAULT_SUBTITLE_ANIMATION_PRESET,
  DEFAULT_SUBTITLE_LAYOUT_MODE,
  DEFAULT_SUBTITLE_TEXT_CASE,
  subtitleAnimationPresetSchema,
  subtitleLayoutModeSchema,
  subtitleTextCaseSchema,
} from "./tiktok-ass";

export const subtitleStylePresetSchema = z.enum(["shorts-bold", "minimal-clean", "cinema-pop", "viral-neon"]);
export const hexColorSchema = z
  .string()
  .regex(/^#([A-Fa-f0-9]{6})$/, "Color must use #RRGGBB format.");
export const safeAreaBottomPercentSchema = z
  .number()
  .int()
  .min(4)
  .max(20)
  .describe("Bottom safe area margin percentage of video height.");

const styleUsedSchema = z.object({
  preset: subtitleStylePresetSchema,
  baseColor: hexColorSchema,
  highlightColor: hexColorSchema,
  textCase: subtitleTextCaseSchema,
  layoutMode: subtitleLayoutModeSchema,
  animationPreset: subtitleAnimationPresetSchema,
  safeAreaBottomPercent: safeAreaBottomPercentSchema,
});

const baseSubtitleInputSchema = z.object({
  words: z.array(
    z.object({
      word: z.string(),
      start: z.number(),
      end: z.number(),
    }),
  ),
  segments: z.array(
    z.object({
      text: z.string(),
      start: z.number(),
      end: z.number(),
    }),
  ),
  fullText: z.string(),
  language: z.string(),
  chunksProcessed: z.number(),
  assPath: z.string(),
  assLines: z.number(),
});

const DEFAULT_STYLE_PRESET: z.infer<typeof subtitleStylePresetSchema> = "shorts-bold";
const DEFAULT_BASE_COLOR = "#FFFFFF";
const DEFAULT_HIGHLIGHT_COLOR = "#00E5FF";
const DEFAULT_SAFE_AREA_BOTTOM_PERCENT = 8;

const stylePresetMap: Record<
  z.infer<typeof subtitleStylePresetSchema>,
  {
    fontName: string;
    relativeSize: number;
    outline: number;
    shadow: number;
    marginV: number;
    bold: 0 | -1;
  }
> = {
  "shorts-bold": {
    fontName: "Arial Black",
    relativeSize: 0.061,
    outline: 4,
    shadow: 1,
    marginV: 48,
    bold: -1,
  },
  "minimal-clean": {
    fontName: "Arial",
    relativeSize: 0.05,
    outline: 2,
    shadow: 0,
    marginV: 42,
    bold: 0,
  },
  "cinema-pop": {
    fontName: "Trebuchet MS",
    relativeSize: 0.055,
    outline: 3,
    shadow: 1,
    marginV: 54,
    bold: -1,
  },
  "viral-neon": {
    fontName: "Arial Black",
    relativeSize: 0.06,
    outline: 4,
    shadow: 2,
    marginV: 58,
    bold: -1,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveDynamicStyleMetrics(
  preset: z.infer<typeof subtitleStylePresetSchema>,
  videoWidth: number,
  videoHeight: number,
): { fontSize: number; marginV: number; outline: number; shadow: number } {
  const presetConfig = stylePresetMap[preset];
  const isVertical = videoHeight > videoWidth;

  const minDim = Math.min(videoWidth, videoHeight);
  const ratioBoost = isVertical ? 1.08 : 0.94;
  const fontSize = clamp(Math.round(videoHeight * presetConfig.relativeSize * ratioBoost), 24, 78);
  const marginV = clamp(Math.round(videoHeight * (isVertical ? 0.075 : 0.055)), 24, 120);
  const outline = clamp(Math.round(minDim * 0.0036), 2, 6);
  const shadow = clamp(Math.round(minDim * 0.0012), 0, 2);

  return { fontSize, marginV, outline, shadow };
}

function normalizeHexColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const normalized = input.trim().toUpperCase();
  return /^#([A-F0-9]{6})$/.test(normalized) ? normalized : fallback;
}

function assColorFromHex(hexColor: string): string {
  const color = normalizeHexColor(hexColor, DEFAULT_BASE_COLOR);
  const rr = color.slice(1, 3);
  const gg = color.slice(3, 5);
  const bb = color.slice(5, 7);
  return `&H00${bb}${gg}${rr}`;
}

function buildSubtitleForceStyle(
  preset: z.infer<typeof subtitleStylePresetSchema>,
  baseColor: string,
  highlightColor: string,
  videoWidth: number,
  videoHeight: number,
  safeAreaBottomPercent: number,
): string {
  const presetConfig = stylePresetMap[preset];
  const primaryColour = assColorFromHex(baseColor);
  const secondaryColour = assColorFromHex(highlightColor);
  const metrics = resolveDynamicStyleMetrics(preset, videoWidth, videoHeight);
  const isVertical = videoHeight > videoWidth;
  const marginH = isVertical ? 42 : 60;
  const borderStyle = 1;
  const backColour =
    preset === "cinema-pop"
      ? "&H00000000"
      : preset === "viral-neon"
        ? "&H50000000"
        : "&H64000000";
  const outlineColour = preset === "viral-neon" ? "&H00401000" : "&H00000000";
  const outline = preset === "viral-neon" ? clamp(metrics.outline + 1, 2, 7) : metrics.outline;
  const shadow = preset === "viral-neon" ? clamp(metrics.shadow + 1, 0, 3) : metrics.shadow;
  const minSafeMarginV = Math.round((videoHeight * safeAreaBottomPercent) / 100);
  const marginV = Math.max(metrics.marginV, minSafeMarginV);
  const spacing = preset === "viral-neon" ? 0.35 : 0;

  return [
    `Fontname=${presetConfig.fontName}`,
    `Fontsize=${metrics.fontSize}`,
    `PrimaryColour=${primaryColour}`,
    `SecondaryColour=${secondaryColour}`,
    `OutlineColour=${outlineColour}`,
    `BackColour=${backColour}`,
    `BorderStyle=${borderStyle}`,
    `Outline=${outline}`,
    `Shadow=${shadow}`,
    "Alignment=2",
    `MarginL=${marginH}`,
    `MarginR=${marginH}`,
    `MarginV=${marginV}`,
    `Spacing=${spacing}`,
    `Bold=${presetConfig.bold}`,
  ].join(",");
}

function escapePathForSubtitlesFilter(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export const subtitleBurnApprovalStep = createStep({
  id: "subtitle-burn-approval",
  description: "Pauses to ask if subtitles should be burned into the video.",
  inputSchema: baseSubtitleInputSchema,
  suspendSchema: z.object({
    message: z.string(),
    assPath: z.string(),
    sourceFilePath: z.string(),
    stylePresets: z.array(subtitleStylePresetSchema),
    textCaseOptions: z.array(subtitleTextCaseSchema),
    layoutModes: z.array(subtitleLayoutModeSchema),
    animationPresets: z.array(subtitleAnimationPresetSchema),
    defaultValues: z.object({
      applyToVideo: z.boolean(),
      stylePreset: subtitleStylePresetSchema,
      baseColor: hexColorSchema,
      highlightColor: hexColorSchema,
      textCase: subtitleTextCaseSchema,
      layoutMode: subtitleLayoutModeSchema,
      animationPreset: subtitleAnimationPresetSchema,
      safeAreaBottomPercent: safeAreaBottomPercentSchema,
    }),
  }),
  resumeSchema: z.object({
    applyToVideo: z.boolean(),
    stylePreset: subtitleStylePresetSchema.optional().default(DEFAULT_STYLE_PRESET),
    baseColor: hexColorSchema.optional().default(DEFAULT_BASE_COLOR),
    highlightColor: hexColorSchema.optional().default(DEFAULT_HIGHLIGHT_COLOR),
    textCase: subtitleTextCaseSchema.optional().default(DEFAULT_SUBTITLE_TEXT_CASE),
    layoutMode: subtitleLayoutModeSchema.optional().default(DEFAULT_SUBTITLE_LAYOUT_MODE),
    animationPreset: subtitleAnimationPresetSchema.optional().default(DEFAULT_SUBTITLE_ANIMATION_PRESET),
    safeAreaBottomPercent: safeAreaBottomPercentSchema.optional().default(DEFAULT_SAFE_AREA_BOTTOM_PERCENT),
  }),
  outputSchema: baseSubtitleInputSchema.extend({
    sourceFilePath: z.string(),
    isVideoInput: z.boolean(),
    applyToVideo: z.boolean(),
    stylePreset: subtitleStylePresetSchema,
    baseColor: hexColorSchema,
    highlightColor: hexColorSchema,
    textCase: subtitleTextCaseSchema,
    layoutMode: subtitleLayoutModeSchema,
    animationPreset: subtitleAnimationPresetSchema,
    safeAreaBottomPercent: safeAreaBottomPercentSchema,
    burnMessage: z.string(),
  }),
  execute: async ({ inputData, getInitData, resumeData, suspend }) => {
    const initData = getInitData() as { filePath?: unknown } | undefined;
    const rawSource = typeof initData?.filePath === "string" ? initData.filePath : "";
    const sourceFilePath = rawSource ? sanitizePath(rawSource) : "";
    const sourceAbsPath = path.join(WORKSPACE_PATH, sourceFilePath);

    const isVideoInput = sourceFilePath
      ? await hasVideoStream(sourceAbsPath).catch(() => false)
      : false;

    if (!isVideoInput) {
      return {
        ...inputData,
        sourceFilePath,
        isVideoInput: false,
        applyToVideo: false,
        stylePreset: DEFAULT_STYLE_PRESET,
        baseColor: DEFAULT_BASE_COLOR,
        highlightColor: DEFAULT_HIGHLIGHT_COLOR,
        textCase: DEFAULT_SUBTITLE_TEXT_CASE,
        layoutMode: DEFAULT_SUBTITLE_LAYOUT_MODE,
        animationPreset: DEFAULT_SUBTITLE_ANIMATION_PRESET,
        safeAreaBottomPercent: DEFAULT_SAFE_AREA_BOTTOM_PERCENT,
        burnMessage: "Subtitles generated. Input has no video stream, so burn-in was skipped.",
      };
    }

    if (!resumeData) {
      return await suspend({
        message:
          "Subtitles were created successfully. Do you want to burn them into the video now? You can choose preset, base color, karaoke highlight color, text case, layout mode, and animation style.",
        assPath: inputData.assPath,
        sourceFilePath,
        stylePresets: subtitleStylePresetSchema.options,
        textCaseOptions: subtitleTextCaseSchema.options,
        layoutModes: subtitleLayoutModeSchema.options,
        animationPresets: subtitleAnimationPresetSchema.options,
        defaultValues: {
          applyToVideo: true,
          stylePreset: DEFAULT_STYLE_PRESET,
          baseColor: DEFAULT_BASE_COLOR,
          highlightColor: DEFAULT_HIGHLIGHT_COLOR,
          textCase: DEFAULT_SUBTITLE_TEXT_CASE,
          layoutMode: DEFAULT_SUBTITLE_LAYOUT_MODE,
          animationPreset: DEFAULT_SUBTITLE_ANIMATION_PRESET,
          safeAreaBottomPercent: DEFAULT_SAFE_AREA_BOTTOM_PERCENT,
        },
      });
    }

    const stylePreset = resumeData.stylePreset ?? DEFAULT_STYLE_PRESET;
    const baseColor = normalizeHexColor(resumeData.baseColor, DEFAULT_BASE_COLOR);
    const highlightColor = normalizeHexColor(resumeData.highlightColor, DEFAULT_HIGHLIGHT_COLOR);
    const textCase = resumeData.textCase ?? DEFAULT_SUBTITLE_TEXT_CASE;
    const layoutMode = resumeData.layoutMode ?? DEFAULT_SUBTITLE_LAYOUT_MODE;
    const animationPreset = resumeData.animationPreset ?? DEFAULT_SUBTITLE_ANIMATION_PRESET;
    const safeAreaBottomPercent = resumeData.safeAreaBottomPercent ?? DEFAULT_SAFE_AREA_BOTTOM_PERCENT;

    return {
      ...inputData,
      sourceFilePath,
      isVideoInput: true,
      applyToVideo: resumeData.applyToVideo,
      stylePreset,
      baseColor,
      highlightColor,
      textCase,
      layoutMode,
      animationPreset,
      safeAreaBottomPercent,
      burnMessage: resumeData.applyToVideo
        ? "User approved subtitle burn-in with custom style settings."
        : "User declined subtitle burn-in. Returning .ass file only.",
    };
  },
});

export const burnSubtitlesStep = createStep({
  id: "burn-subtitles",
  description: "Burns generated subtitles into the video using FFmpeg subtitles filter.",
  inputSchema: baseSubtitleInputSchema.extend({
    sourceFilePath: z.string(),
    isVideoInput: z.boolean(),
    applyToVideo: z.boolean(),
    stylePreset: subtitleStylePresetSchema,
    baseColor: hexColorSchema,
    highlightColor: hexColorSchema,
    textCase: subtitleTextCaseSchema,
    layoutMode: subtitleLayoutModeSchema,
    animationPreset: subtitleAnimationPresetSchema,
    safeAreaBottomPercent: safeAreaBottomPercentSchema,
    burnMessage: z.string(),
  }),
  outputSchema: baseSubtitleInputSchema.extend({
    sourceFilePath: z.string(),
    isVideoInput: z.boolean(),
    burnApplied: z.boolean(),
    subtitledVideoPath: z.string().optional(),
    styledAssPath: z.string().optional(),
    burnMessage: z.string(),
    styleUsed: styleUsedSchema.optional(),
  }),
  execute: async ({ inputData }) => {
    const {
      sourceFilePath,
      isVideoInput,
      applyToVideo,
      stylePreset,
      baseColor,
      highlightColor,
      textCase,
      layoutMode,
      animationPreset,
      safeAreaBottomPercent,
      burnMessage,
      ...subtitleData
    } = inputData;

    if (!isVideoInput || !applyToVideo) {
      return {
        ...subtitleData,
        sourceFilePath,
        isVideoInput,
        burnApplied: false,
        burnMessage,
      };
    }

    const inputAbsPath = path.join(WORKSPACE_PATH, sourceFilePath);
    const assAbsPath = path.join(WORKSPACE_PATH, subtitleData.assPath);

    if (!fs.existsSync(inputAbsPath)) {
      throw new Error(`Source video not found: ${sourceFilePath}`);
    }
    if (!fs.existsSync(assAbsPath)) {
      throw new Error(`Subtitle file not found: ${subtitleData.assPath}`);
    }

    const { width, height } = await getVideoDimensions(inputAbsPath);

    const sourceExt = path.extname(sourceFilePath) || ".mp4";
    const sourceBase = path.basename(sourceFilePath, sourceExt);
    const outputRelPath = path.join("subtitle_file", `${sourceBase}_subtitled.mp4`);
    const outputAbsPath = path.join(WORKSPACE_PATH, outputRelPath);
    const styledAssRelPath = path.join("subtitle_file", `${sourceBase}_styled.ass`);
    const styledAssAbsPath = path.join(WORKSPACE_PATH, styledAssRelPath);

    fs.mkdirSync(path.dirname(outputAbsPath), { recursive: true });

    const { assContent } = buildTikTokAss({
      title: sourceBase,
      words: subtitleData.words,
      textCase,
      layoutMode,
      animationPreset,
      videoWidth: width,
      videoHeight: height,
    });
    fs.writeFileSync(styledAssAbsPath, assContent, "utf8");

    const forceStyle = buildSubtitleForceStyle(
      stylePreset,
      baseColor,
      highlightColor,
      width,
      height,
      safeAreaBottomPercent,
    );
    const escapedAssPath = escapePathForSubtitlesFilter(styledAssAbsPath);
    const subtitlesFilter = `subtitles='${escapedAssPath}':force_style='${forceStyle}'`;

    await new Promise<void>((resolve, reject) => {
      const { proc } = spawnWithTimeout(ffmpegInstaller.path, [
        "-i",
        inputAbsPath,
        "-vf",
        subtitlesFilter,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-y",
        outputAbsPath,
      ]);

      const stderr = cappedStderr(proc);

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg burn subtitles failed (code ${code}): ${stderr.get().slice(-1200)}`));
      });

      proc.on("error", (err) => {
        reject(new Error(`ffmpeg process error: ${err.message}`));
      });
    });

    if (!fs.existsSync(outputAbsPath)) {
      throw new Error(`Subtitled output was not created: ${outputRelPath}`);
    }

    return {
      ...subtitleData,
      sourceFilePath,
      isVideoInput,
      burnApplied: true,
      subtitledVideoPath: outputRelPath,
      styledAssPath: styledAssRelPath,
      burnMessage: `Subtitles were burned successfully to ${outputRelPath}.`,
      styleUsed: {
        preset: stylePreset,
        baseColor,
        highlightColor,
        textCase,
        layoutMode,
        animationPreset,
        safeAreaBottomPercent,
      },
    };
  },
});
