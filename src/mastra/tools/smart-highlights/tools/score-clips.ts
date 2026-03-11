import {
  type Moment,
  type TranscriptionSegment,
  type VisualScene,
} from "../types";
import { CONTENT_TYPE_WEIGHTS } from "../constants";

/**
 * Score clips using weighted combination of textual and visual analysis.
 *
 * Scoring formula: combined = (textScore * textWeight) + (visualScore * visualWeight)
 *
 * Content type weights:
 * - textual: 70% text, 30% visual
 * - visual: 30% text, 70% visual
 *
 * When one modality is missing, the other gets 100% weight.
 *
 * The scoring pipeline:
 * 1. Build unified moments from segment and scene boundaries.
 * 2. Compute corpus-level statistics (median text length, word frequencies,
 *    scene significance range) so individual scores reflect relative importance.
 * 3. Score each moment with multi-signal text and visual heuristics.
 * 4. Return moments sorted by combined score descending.
 */

// ---------------------------------------------------------------------------
// Corpus statistics — computed once per call to avoid per-moment recomputation
// ---------------------------------------------------------------------------

interface TextCorpusStats {
  /** Median segment text length (characters) */
  medianLength: number;
  /** Median words-per-second across all segments */
  medianWps: number;
  /** Global word frequency map for TF-IDF-like vocabulary scoring */
  wordFrequency: Map<string, number>;
  /** Total number of segments */
  totalSegments: number;
}

interface VisualCorpusStats {
  /** Minimum significance across all scenes */
  minSig: number;
  /** Maximum significance across all scenes */
  maxSig: number;
  /** Range (max - min); 0 when all values are identical */
  range: number;
}

function buildTextCorpusStats(segments: TranscriptionSegment[]): TextCorpusStats {
  if (segments.length === 0) {
    return { medianLength: 1, medianWps: 1, wordFrequency: new Map(), totalSegments: 0 };
  }

  const lengths = segments.map((s) => s.text.length).sort((a, b) => a - b);
  const medianLength = lengths[Math.floor(lengths.length / 2)] ?? 1;

  const wpsList = segments.map((s) => {
    const dur = s.end - s.start;
    if (dur <= 0) return 0;
    const wordCount = s.text.trim().split(/\s+/).filter(Boolean).length;
    return wordCount / dur;
  }).sort((a, b) => a - b);
  const medianWps = wpsList[Math.floor(wpsList.length / 2)] ?? 1;

  // Build global word frequency for vocabulary richness scoring
  const wordFrequency = new Map<string, number>();
  for (const seg of segments) {
    const words = seg.text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
    const seen = new Set<string>();
    for (const w of words) {
      if (!seen.has(w)) {
        seen.add(w);
        wordFrequency.set(w, (wordFrequency.get(w) ?? 0) + 1);
      }
    }
  }

  return { medianLength, medianWps: medianWps || 1, wordFrequency, totalSegments: segments.length };
}

function buildVisualCorpusStats(scenes: VisualScene[]): VisualCorpusStats {
  if (scenes.length === 0) return { minSig: 0, maxSig: 1, range: 1 };
  let minSig = Infinity;
  let maxSig = -Infinity;
  for (const s of scenes) {
    if (s.significance < minSig) minSig = s.significance;
    if (s.significance > maxSig) maxSig = s.significance;
  }
  const range = maxSig - minSig;
  return { minSig, maxSig, range };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score moments and return them sorted by combined score descending.
 */
export function scoreClips(
  segments: TranscriptionSegment[],
  scenes: VisualScene[],
  contentType: "textual" | "visual",
  videoDuration: number
): Moment[] {
  console.log(`[scoreClips] Starting clip scoring`);
  console.log(`[scoreClips] Content type: ${contentType}`);
  console.log(`[scoreClips] Input segments: ${segments.length}, scenes: ${scenes.length}`);

  const hasText = segments.length > 0;
  const hasVisual = scenes.length > 0;

  let textWeight: number;
  let visualWeight: number;

  if (hasText && hasVisual) {
    const weights = CONTENT_TYPE_WEIGHTS[contentType];
    textWeight = weights.text;
    visualWeight = weights.visual;
  } else if (hasText && !hasVisual) {
    textWeight = 1.0;
    visualWeight = 0.0;
  } else if (!hasText && hasVisual) {
    textWeight = 0.0;
    visualWeight = 1.0;
  } else {
    console.warn(`[scoreClips] No segments or scenes provided`);
    return [];
  }

  console.log(`[scoreClips] Using weights - text: ${textWeight}, visual: ${visualWeight}`);

  const moments = createUnifiedMoments(segments, scenes, videoDuration);

  // Pre-compute corpus-level statistics once
  const textStats = buildTextCorpusStats(segments);
  const visualStats = buildVisualCorpusStats(scenes);

  const scoredMoments: Moment[] = moments.map((moment) => {
    const textScore = hasText ? calculateTextScore(moment, segments, textStats) : 0;
    const visualScore = hasVisual ? calculateVisualScore(moment, scenes, visualStats) : 0;
    const combinedScore = parseFloat(
      (textScore * textWeight + visualScore * visualWeight).toFixed(3)
    );
    return {
      start: moment.start,
      end: moment.end,
      textScore: parseFloat(textScore.toFixed(3)),
      visualScore: parseFloat(visualScore.toFixed(3)),
      combinedScore,
    };
  });

  scoredMoments.sort((a, b) => b.combinedScore - a.combinedScore);

  console.log(`[scoreClips] Scored ${scoredMoments.length} moments`);
  if (scoredMoments.length > 0) {
    const top = scoredMoments[0]!;
    const bottom = scoredMoments[scoredMoments.length - 1]!;
    console.log(
      `[scoreClips] Score range: ${top.combinedScore} (best) → ${bottom.combinedScore} (worst)`
    );
  }

  return scoredMoments;
}

/**
 * Create unified moments from segment and scene boundaries.
 *
 * Instead of fragmenting the timeline into micro-intervals at every boundary
 * (which caused all overlapRatios to be 1.0 and destroyed score variance),
 * we use the original transcription segments as the primary moments — each
 * represents a natural unit of speech. Gaps between segments are filled with
 * scene-boundary intervals so the full timeline is still covered.
 */
export function createUnifiedMoments(
  segments: TranscriptionSegment[],
  scenes: VisualScene[],
  videoDuration: number
): Array<{ start: number; end: number }> {
  // If we have transcription segments, use them as the primary moment source.
  // They represent natural speech units (typically 3-15 seconds) and avoid
  // the micro-fragmentation problem.
  if (segments.length > 0) {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const moments: Array<{ start: number; end: number }> = [];

    for (const seg of sorted) {
      const start = Math.max(0, seg.start);
      const end = Math.min(videoDuration, seg.end);
      if (end > start) {
        moments.push({ start, end });
      }
    }

    // Fill gaps with scene-boundary intervals so visual-only regions are also scored
    if (scenes.length > 0 && moments.length > 0) {
      const gaps: Array<{ start: number; end: number }> = [];

      // Gap before the first segment
      if (moments[0]!.start > 0) {
        gaps.push({ start: 0, end: moments[0]!.start });
      }
      // Gaps between segments
      for (let i = 0; i < moments.length - 1; i++) {
        const gapStart = moments[i]!.end;
        const gapEnd = moments[i + 1]!.start;
        if (gapEnd > gapStart + 0.1) {
          gaps.push({ start: gapStart, end: gapEnd });
        }
      }
      // Gap after the last segment
      const lastEnd = moments[moments.length - 1]!.end;
      if (lastEnd < videoDuration - 0.1) {
        gaps.push({ start: lastEnd, end: videoDuration });
      }

      // Split gaps using scene boundaries
      for (const gap of gaps) {
        const scenePoints = new Set<number>([gap.start, gap.end]);
        for (const scene of scenes) {
          if (scene.start > gap.start && scene.start < gap.end) scenePoints.add(scene.start);
          if (scene.end > gap.start && scene.end < gap.end) scenePoints.add(scene.end);
        }
        const pts = [...scenePoints].sort((a, b) => a - b);
        for (let i = 0; i < pts.length - 1; i++) {
          const s = pts[i]!;
          const e = pts[i + 1]!;
          if (e > s + 0.05) {
            moments.push({ start: s, end: e });
          }
        }
      }

      moments.sort((a, b) => a.start - b.start);
    }

    return moments;
  }

  // No transcription segments — fall back to scene-based moments
  if (scenes.length > 0) {
    const sorted = [...scenes].sort((a, b) => a.start - b.start);
    const moments: Array<{ start: number; end: number }> = [];
    for (const scene of sorted) {
      const start = Math.max(0, scene.start);
      const end = Math.min(videoDuration, scene.end);
      if (end > start) {
        moments.push({ start, end });
      }
    }
    return moments;
  }

  // Nothing available
  return [];
}

/**
 * Calculate text score for a moment based on overlapping segments.
 *
 * Multi-signal scoring:
 * - **Speech density** (30%): words-per-second relative to the corpus median.
 *   Higher density = more information packed into the time window.
 * - **Vocabulary richness** (30%): ratio of "rare" words (appear in ≤ 25% of
 *   segments) to total words. Segments with more unique/topic-specific words
 *   are more likely to be highlights.
 * - **Relative text length** (20%): segment length relative to the corpus median.
 *   Very short segments (fillers, "um", "yeah") score low.
 * - **Overlap coverage** (20%): how much of the moment is covered by speech.
 *   Moments with silence gaps score lower.
 */
export function calculateTextScore(
  moment: { start: number; end: number },
  segments: TranscriptionSegment[],
  stats?: TextCorpusStats
): number {
  const momentDuration = moment.end - moment.start;
  if (momentDuration <= 0) return 0;

  // Build stats on the fly if not provided (backward compat with tests)
  const corpus = stats ?? buildTextCorpusStats(segments);

  let totalOverlap = 0;
  let bestSegmentScore = 0;

  for (const segment of segments) {
    const overlapStart = Math.max(moment.start, segment.start);
    const overlapEnd = Math.min(moment.end, segment.end);

    if (overlapEnd <= overlapStart) continue;

    const overlapDuration = overlapEnd - overlapStart;
    totalOverlap += overlapDuration;

    // --- Signal 1: Speech density (words per second) ---
    const segDuration = segment.end - segment.start;
    const words = segment.text.trim().split(/\s+/).filter(Boolean);
    const wps = segDuration > 0 ? words.length / segDuration : 0;
    // Normalize against median: 1.0 at median, capped at 0-1
    const densityScore = Math.min(1, wps / (corpus.medianWps * 2));

    // --- Signal 2: Vocabulary richness ---
    const rareThreshold = Math.max(1, Math.ceil(corpus.totalSegments * 0.25));
    const uniqueWords = new Set(
      words.map((w) => w.toLowerCase().replace(/[^\w]/g, "")).filter(Boolean)
    );
    let rareCount = 0;
    for (const w of uniqueWords) {
      if ((corpus.wordFrequency.get(w) ?? 0) <= rareThreshold) {
        rareCount++;
      }
    }
    const vocabScore = uniqueWords.size > 0 ? rareCount / uniqueWords.size : 0;

    // --- Signal 3: Relative text length ---
    const lengthScore = Math.min(1, segment.text.length / (corpus.medianLength * 2));

    // --- Composite segment score ---
    const segScore = densityScore * 0.3 + vocabScore * 0.3 + lengthScore * 0.2;

    // Weight by overlap proportion with this segment
    const overlapWeight = overlapDuration / momentDuration;
    const weighted = segScore * overlapWeight;
    bestSegmentScore = Math.max(bestSegmentScore, weighted);
  }

  // --- Signal 4: Overlap coverage ---
  const coverageScore = totalOverlap / momentDuration;

  // Final: best segment quality (80%) + coverage (20%)
  return Math.min(1, bestSegmentScore + coverageScore * 0.2);
}

/**
 * Calculate visual score for a moment based on overlapping scenes.
 *
 * Uses min-max normalization across all scenes so there's actual variance
 * even when raw significance values are clustered (e.g. all 0.7). When all
 * scenes have the same significance, normalization produces 0.5 (neutral)
 * to avoid division-by-zero or degenerate scores.
 */
export function calculateVisualScore(
  moment: { start: number; end: number },
  scenes: VisualScene[],
  stats?: VisualCorpusStats
): number {
  const momentDuration = moment.end - moment.start;
  if (momentDuration <= 0) return 0;

  const corpus = stats ?? buildVisualCorpusStats(scenes);

  let weightedScore = 0;
  let totalOverlap = 0;

  for (const scene of scenes) {
    const overlapStart = Math.max(moment.start, scene.start);
    const overlapEnd = Math.min(moment.end, scene.end);

    if (overlapEnd > overlapStart) {
      const overlapDuration = overlapEnd - overlapStart;
      totalOverlap += overlapDuration;

      // Min-max normalize significance so values spread across 0-1
      const normalizedSig = corpus.range > 0
        ? (scene.significance - corpus.minSig) / corpus.range
        : 0.5; // All scenes have same significance → neutral

      weightedScore += normalizedSig * overlapDuration;
    }
  }

  if (totalOverlap === 0) return 0;

  return weightedScore / totalOverlap;
}
