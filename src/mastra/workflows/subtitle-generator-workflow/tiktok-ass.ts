import z from "zod";

export const subtitleTextCaseSchema = z.enum(["uppercase", "original"]);
export const subtitleLayoutModeSchema = z.enum(["one-line", "two-lines", "auto"]);
export const subtitleAnimationPresetSchema = z.enum(["tiktok-pop", "smooth"]);

export const DEFAULT_SUBTITLE_TEXT_CASE: z.infer<typeof subtitleTextCaseSchema> = "uppercase";
export const DEFAULT_SUBTITLE_LAYOUT_MODE: z.infer<typeof subtitleLayoutModeSchema> = "two-lines";
export const DEFAULT_SUBTITLE_ANIMATION_PRESET: z.infer<typeof subtitleAnimationPresetSchema> = "tiktok-pop";

export type KaraokeWord = {
  word: string;
  start: number;
  end: number;
};

type BuildTikTokAssParams = {
  title: string;
  words: KaraokeWord[];
  textCase: z.infer<typeof subtitleTextCaseSchema>;
  layoutMode: z.infer<typeof subtitleLayoutModeSchema>;
  animationPreset: z.infer<typeof subtitleAnimationPresetSchema>;
  videoWidth?: number;
  videoHeight?: number;
};

type CaptionPage = {
  start: number;
  end: number;
  words: KaraokeWord[];
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function formatAssTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function normalizeWordText(raw: string, textCase: z.infer<typeof subtitleTextCaseSchema>): string {
  const trimmed = raw.trim();
  if (textCase === "uppercase") {
    return trimmed.toUpperCase();
  }
  return trimmed;
}

function isPunctuationOnly(token: string): boolean {
  return /^[,.;:!?%)}\]»"'”’]+$/.test(token);
}

function decideEffectiveLayout(
  layoutMode: z.infer<typeof subtitleLayoutModeSchema>,
  videoWidth: number,
  videoHeight: number,
): "one-line" | "two-lines" {
  if (layoutMode !== "auto") return layoutMode;
  const isVertical = videoHeight > videoWidth;
  return isVertical ? "two-lines" : "one-line";
}

function groupWordsIntoPages(
  words: KaraokeWord[],
  layout: "one-line" | "two-lines",
  maxCharsPerLine: number,
  isVertical: boolean,
): CaptionPage[] {
  if (words.length === 0) return [];

  const sorted = [...words]
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [];
  const firstWord = sorted[0]!;

  const maxWords =
    layout === "one-line"
      ? isVertical
        ? 4
        : 7
      : isVertical
        ? 7
        : 10;
  const maxDurationMs =
    layout === "one-line"
      ? isVertical
        ? 920
        : 1200
      : isVertical
        ? 1120
        : 1360;
  const maxCharsTotal =
    layout === "one-line"
      ? maxCharsPerLine
      : isVertical
        ? maxCharsPerLine * 2 + 3
        : maxCharsPerLine * 2 + 8;

  const pages: CaptionPage[] = [];
  let current: KaraokeWord[] = [];
  let pageStart = firstWord.start;
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    pages.push({
      start: pageStart,
      end: current[current.length - 1]!.end,
      words: current,
    });
    current = [];
    currentChars = 0;
  };

  for (const word of sorted) {
    const tokenLen = word.word.trim().length;

    if (current.length === 0) {
      current.push(word);
      pageStart = word.start;
      currentChars = tokenLen;
      continue;
    }

    const durationMs = (word.end - pageStart) * 1000;
    const nextWordsCount = current.length + 1;
    const nextChars = currentChars + 1 + tokenLen;
    const gapMs = (word.start - current[current.length - 1]!.end) * 1000;
    const shouldBreak =
      durationMs > maxDurationMs ||
      nextWordsCount > maxWords ||
      nextChars > maxCharsTotal ||
      gapMs > 340;

    if (shouldBreak) {
      flush();
      current.push(word);
      pageStart = word.start;
      currentChars = tokenLen;
    } else {
      current.push(word);
      currentChars = nextChars;
    }
  }

  flush();
  return pages;
}

function calculateLineBreakIndex(words: string[], maxCharsPerLine: number): number {
  if (words.length < 4) return -1;

  const totalChars = words.reduce((sum, w) => sum + w.length, 0) + (words.length - 1);
  const target = Math.round(totalChars / 2);

  let running = 0;
  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 1; i < words.length - 1; i++) {
    running += words[i - 1]!.length;
    if (i > 1) running += 1;

    const left = running;
    const right = totalChars - running - 1;
    if (left > maxCharsPerLine || right > maxCharsPerLine) continue;

    const score = Math.abs(left - target) + Math.abs(right - target);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function animationPrefix(
  animationPreset: z.infer<typeof subtitleAnimationPresetSchema>,
  isVertical: boolean,
): string {
  if (animationPreset === "smooth") {
    return isVertical
      ? "{\\an2\\blur0.8\\fscx96\\fscy96\\t(0,160,\\fscx100\\fscy100)\\fad(90,70)}"
      : "{\\an2\\blur0.6\\fscx97\\fscy97\\t(0,140,\\fscx100\\fscy100)\\fad(90,80)}";
  }
  return isVertical
    ? "{\\an2\\blur0.9\\fscx82\\fscy82\\t(0,110,\\fscx112\\fscy112)\\t(110,220,\\fscx100\\fscy100)\\fad(45,55)}"
    : "{\\an2\\blur0.7\\fscx86\\fscy86\\t(0,110,\\fscx108\\fscy108)\\t(110,220,\\fscx100\\fscy100)\\fad(50,60)}";
}

function buildKaraokeText(
  words: KaraokeWord[],
  textCase: z.infer<typeof subtitleTextCaseSchema>,
  layout: "one-line" | "two-lines",
  maxCharsPerLine: number,
  animationPreset: z.infer<typeof subtitleAnimationPresetSchema>,
  isVertical: boolean,
): string {
  if (words.length === 0) return "";

  const tokenTexts = words.map((w) => escapeAssText(normalizeWordText(w.word, textCase)));
  const breakIndex = layout === "two-lines" ? calculateLineBreakIndex(tokenTexts, maxCharsPerLine) : -1;

  const parts: string[] = [animationPrefix(animationPreset, isVertical)];

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const token = tokenTexts[i]!;
    const durCs = Math.max(1, Math.round((w.end - w.start) * 100));

    let prefix = "";
    if (i > 0) {
      if (breakIndex > 0 && i === breakIndex) {
        prefix = "\\N";
      } else if (!isPunctuationOnly(token)) {
        prefix = " ";
      }
    }

    parts.push(`{\\k${durCs}}${prefix}${token}`);
  }

  return parts.join("");
}

export function buildTikTokAss(params: BuildTikTokAssParams): { assContent: string; assLines: number } {
  const width = params.videoWidth ?? 1080;
  const height = params.videoHeight ?? 1920;
  const isVertical = height > width;
  const maxCharsPerLine = isVertical
    ? clamp(Math.round(width / 34), 12, 20)
    : clamp(Math.round(width / 38), 16, 28);
  const effectiveLayout = decideEffectiveLayout(params.layoutMode, width, height);

  const pages = groupWordsIntoPages(params.words, effectiveLayout, maxCharsPerLine, isVertical);

  const scriptInfo = [
    "[Script Info]",
    `Title: ${escapeAssText(params.title || "Subtitles")}`,
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
  ];

  const styles = [
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,54,&H0000FFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,40,1",
    "",
  ];

  const events: string[] = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  for (const page of pages) {
    const lineText = buildKaraokeText(
      page.words,
      params.textCase,
      effectiveLayout,
      maxCharsPerLine,
      params.animationPreset,
      isVertical,
    );
    events.push(
      `Dialogue: 0,${formatAssTime(page.start)},${formatAssTime(page.end)},Default,,0,0,0,,${lineText}`,
    );
  }

  const assContent = [...scriptInfo, ...styles, ...events].join("\n") + "\n";

  return {
    assContent,
    assLines: Math.max(0, events.length - 2),
  };
}
