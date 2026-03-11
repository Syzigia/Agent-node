import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { WORKSPACE_PATH, sanitizePath } from "../workspace";
import {
  transcriptionSegmentSchema,
  visualSceneSchema,
  momentSchema,
  generatedClipSchema,
  failedClipSchema,
  type TranscriptionSegment,
  type VisualScene,
  type Moment,
} from "../tools/smart-highlights/types";
import {
  MAX_CLIPS,
  MIN_CLIPS,
  MAX_CLIP_DURATION,
  MIN_CLIP_DURATION,
  TARGET_DURATION_TOLERANCE,
  WHISPER_COST_PER_MINUTE,
  COST_WARNING_THRESHOLD_MINUTES,
  CLIP_RETRY_ADJUSTMENT,
  RETRY_ATTEMPTS,
  RETRY_DELAY_MS,
} from "../tools/smart-highlights/constants";
import {
  generateTempPath,
  withRetry,
} from "../tools/smart-highlights/utils";
// Shared core functions — imported from standalone tools to avoid duplication
import {
  checkAudioStream,
  extractAudioToMp3,
} from "../tools/smart-highlights/tools/extract-audio";
import { transcribeChunk } from "../tools/smart-highlights/tools/transcribe-audio";
import {
  getVideoDuration,
  detectScenesWithFallback,
  createUniformScenes,
} from "../tools/smart-highlights/tools/analyze-visual";
import {
  scoreClips,
} from "../tools/smart-highlights/tools/score-clips";
import { generateSingleClip } from "../tools/smart-highlights/tools/generate-clips";
import { removeFiles } from "../tools/smart-highlights/utils";

// ============================================================================
// Step Schemas
// ============================================================================

const configStepInputSchema = z.object({
  file: z.string().describe("Relative path to video file"),
});

const configStepOutputSchema = z.object({
  file: z.string(),
  numberOfClips: z.number().min(1).max(20),
  targetDuration: z.number().min(5).max(300),
  contentType: z.enum(["visual", "textual"]),
  outputFolder: z.string(),
  startedAt: z.number().describe("Unix timestamp (ms) when processing started"),
});

// ============================================================================
// Helper Functions (Clip Selection — workflow-specific, not in standalone tools)
// ============================================================================

async function callLLMForClipSelection(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );
  
  return response.data.choices[0]?.message?.content || "";
}

function buildClipSelectionPrompt(params: {
  videoDuration: number;
  numberOfClips: number;
  targetDuration: number;
  contentType: "visual" | "textual";
  moments: Moment[];
}): string {
  const { videoDuration, numberOfClips, targetDuration, contentType, moments } = params;
  
  const minDuration = targetDuration * (1 - TARGET_DURATION_TOLERANCE);
  const maxDuration = targetDuration * (1 + TARGET_DURATION_TOLERANCE);
  
  return `You are a professional video editor selecting highlight clips from a ${videoDuration.toFixed(1)}-second video.

TASK: Select exactly ${numberOfClips} non-overlapping clips, each approximately ${targetDuration} seconds long (acceptable range: ${minDuration.toFixed(1)}–${maxDuration.toFixed(1)}s).
Content type preference: ${contentType} ("visual" prioritizes exciting visuals, "textual" prioritizes important dialogue).

IMPORTANT: The "moments" below are SHORT scored segments (typically 1–5 seconds each) representing the most interesting points in the video. They are NOT clips. Each clip you produce must be a ${minDuration.toFixed(0)}–${maxDuration.toFixed(0)} second TIME WINDOW placed to encompass one or more high-scoring moments. Do NOT return the moment timestamps as-is.

Scored moments (sorted by quality, highest first):
${moments.slice(0, 20).map((m, i) => `  [${i + 1}] ${m.start.toFixed(1)}s–${m.end.toFixed(1)}s (${(m.end - m.start).toFixed(1)}s) | text: ${m.textScore.toFixed(2)} | visual: ${m.visualScore.toFixed(2)} | combined: ${m.combinedScore.toFixed(2)}`).join("\n")}

STRATEGY:
1. Pick a top-scoring moment and center a ~${targetDuration}s window around it (e.g. moment at 40s → clip from ${Math.max(0, 40 - targetDuration / 2).toFixed(0)}s to ${Math.min(videoDuration, 40 + targetDuration / 2).toFixed(0)}s)
2. Adjust window boundaries to stay within 0s–${videoDuration.toFixed(1)}s
3. Try to include multiple high-scoring moments within each window
4. Ensure clips do not overlap
5. Spread clips across different parts of the video for content diversity

Return ONLY a JSON array in this exact format:
[
  {
    "start": 10.0,
    "end": ${(10 + targetDuration).toFixed(1)},
    "reason": "Brief explanation of why this region was selected"
  }
]`;
}

function parseLLMResponse(response: string): Array<{ start: number; end: number; reason: string }> {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("No JSON array found in LLM response");
  }
  
  const parsed = JSON.parse(jsonMatch[0]);
  
  if (!Array.isArray(parsed)) {
    throw new Error("LLM response is not an array");
  }
  
  return parsed.map((clip: any) => ({
    start: Number(clip.start),
    end: Number(clip.end),
    reason: String(clip.reason || "Selected by LLM"),
  }));
}

function validateClips(
  clips: Array<{ start: number; end: number }>,
  expectedCount: number,
  targetDuration: number,
  videoDuration: number
): boolean {
  if (clips.length !== expectedCount) {
    return false;
  }
  
  const minDuration = targetDuration * (1 - TARGET_DURATION_TOLERANCE);
  const maxDuration = targetDuration * (1 + TARGET_DURATION_TOLERANCE);
  
  for (const clip of clips) {
    const duration = clip.end - clip.start;
    
    if (duration < minDuration || duration > maxDuration) {
      return false;
    }
    
    if (clip.start < 0 || clip.end > videoDuration) {
      return false;
    }
    
    if (clip.start >= clip.end) {
      return false;
    }
  }
  
  return true;
}

/**
 * Expand short scored moments into clips of the target duration.
 *
 * Moments from scoring are individual speech segments (typically 1-5s).
 * This function converts them into clips of the desired length by centering
 * a window of targetDuration around each top moment's midpoint, then
 * greedily selecting non-overlapping windows in score order.
 *
 * When the video is too short to fit numberOfClips non-overlapping windows,
 * fewer clips are returned.
 */
function expandMomentsToClips(
  moments: Moment[],
  numberOfClips: number,
  targetDuration: number,
  videoDuration: number
): Array<{ start: number; end: number; reason: string }> {
  const selected: Array<{ start: number; end: number; reason: string }> = [];

  // Moments are already sorted by combinedScore descending
  for (const moment of moments) {
    if (selected.length >= numberOfClips) break;

    // Center a targetDuration window around this moment's midpoint
    const midpoint = (moment.start + moment.end) / 2;
    let clipStart = midpoint - targetDuration / 2;
    let clipEnd = midpoint + targetDuration / 2;

    // Clamp to video boundaries, shifting the window to preserve duration
    if (clipStart < 0) {
      clipEnd = Math.min(videoDuration, clipEnd - clipStart);
      clipStart = 0;
    }
    if (clipEnd > videoDuration) {
      clipStart = Math.max(0, clipStart - (clipEnd - videoDuration));
      clipEnd = videoDuration;
    }

    // Check for overlap with already-selected clips
    const hasOverlap = selected.some(
      (existing) => clipStart < existing.end && clipEnd > existing.start
    );

    if (!hasOverlap) {
      selected.push({
        start: parseFloat(clipStart.toFixed(2)),
        end: parseFloat(clipEnd.toFixed(2)),
        reason: `Highlight region centered on top moment at ${moment.start.toFixed(1)}s (score: ${moment.combinedScore.toFixed(3)})`,
      });
    }
  }

  return selected;
}

function selectClipsAlgorithmically(
  moments: Moment[],
  numberOfClips: number,
  targetDuration: number,
  videoDuration: number
): Array<{ start: number; end: number; reason: string }> {
  return expandMomentsToClips(moments, numberOfClips, targetDuration, videoDuration);
}

function resolveOverlappingClips(
  clips: Array<{ start: number; end: number; reason: string }>
): Array<{ start: number; end: number; reason: string }> {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const resolved: typeof clips = [];
  
  for (const clip of sorted) {
    const hasOverlap = resolved.some(r => 
      (clip.start < r.end && clip.end > r.start)
    );
    
    if (!hasOverlap) {
      resolved.push(clip);
    }
  }
  
  return resolved;
}

// ============================================================================
// Step 1: Configuration (HITL)
// ============================================================================

const configStep = createStep({
  id: "config-step",
  description: "Collect user preferences for highlight extraction",
  inputSchema: configStepInputSchema,
  suspendSchema: z.object({
    message: z.string(),
    file: z.string(),
    costWarning: z.string().optional(),
    defaultValues: z.object({
      numberOfClips: z.number(),
      targetDuration: z.number(),
      contentType: z.enum(["visual", "textual"]),
      outputFolder: z.string(),
    }),
  }),
  resumeSchema: z.object({
    numberOfClips: z.number().min(MIN_CLIPS).max(MAX_CLIPS),
    targetDuration: z.number().min(MIN_CLIP_DURATION).max(MAX_CLIP_DURATION),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
  }),
  outputSchema: configStepOutputSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    console.log("[configStep] Starting configuration step...");
    
    const file = sanitizePath(inputData.file);
    const videoPath = path.join(WORKSPACE_PATH, file);
    
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${file}`);
    }
    
    const duration = await getVideoDuration(videoPath);
    const estimatedMinutes = Math.ceil(duration / 60);
    const estimatedCost = estimatedMinutes * WHISPER_COST_PER_MINUTE;
    
    let costWarning: string | undefined;
    if (estimatedMinutes > COST_WARNING_THRESHOLD_MINUTES) {
      costWarning = `⚠️ This video is approximately ${estimatedMinutes} minutes long. ` +
        `Transcription may cost approximately $${estimatedCost.toFixed(2)} using OpenAI Whisper API.`;
    }
    
    if (!resumeData) {
      console.log("[configStep] Suspending for user configuration...");
      return await suspend({
        message: "Please configure the highlight extraction settings.",
        file,
        costWarning,
        defaultValues: {
          numberOfClips: 3,
          targetDuration: 15,
          contentType: "textual",
          outputFolder: "highlights",
        },
      });
    }
    
    const validatedData = configStepOutputSchema.parse({
      file,
      startedAt: Date.now(),
      ...resumeData,
    });
    
    console.log("[configStep] Configuration received:", validatedData);
    return validatedData;
  },
});

// ============================================================================
// Step 2: Extract Audio
// ============================================================================

const extractAudioStep = createStep({
  id: "extract-audio",
  description: "Extract audio from video file",
  inputSchema: configStepOutputSchema,
  outputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    tempFiles: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    console.log("[extractAudioStep] Starting audio extraction...");
    
    const { file, numberOfClips, targetDuration, contentType, outputFolder, startedAt } = inputData;
    const videoPath = path.join(WORKSPACE_PATH, file);
    const audioPath = generateTempPath(".mp3", "audio");
    const tempFiles: string[] = [audioPath];
    
    try {
      const hasAudio = await checkAudioStream(videoPath);
      
      if (!hasAudio) {
        console.log("[extractAudioStep] No audio stream detected");
        const duration = await getVideoDuration(videoPath);
        return {
          file,
          numberOfClips,
          targetDuration,
          contentType,
          outputFolder,
          startedAt,
          audioPath: "",
          duration,
          hasAudio: false,
          tempFiles,
        };
      }
      
      await withRetry(
        () => extractAudioToMp3(videoPath, audioPath),
        RETRY_ATTEMPTS,
        RETRY_DELAY_MS
      );
      
      const duration = await getVideoDuration(videoPath);
      
      console.log("[extractAudioStep] Audio extraction complete:", duration, "seconds");
      
      return {
          file,
          numberOfClips,
          targetDuration,
          contentType,
          outputFolder,
          startedAt,
          audioPath,
          duration,
          hasAudio: true,
          tempFiles,
        };
    } catch (error: any) {
      console.error("[extractAudioStep] Audio extraction failed:", error.message);
      throw new Error(`Failed to extract audio: ${error.message}`);
    }
  },
});

// ============================================================================
// Step 3: Transcribe Audio + Analyze Visual (M9: run in parallel)
// ============================================================================

const transcribeAndAnalyzeStep = createStep({
  id: "transcribe-and-analyze",
  description: "Transcribe audio and analyze video scenes in parallel",
  inputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    tempFiles: z.array(z.string()),
  }),
  outputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    tempFiles: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    console.log("[transcribeAndAnalyzeStep] Starting parallel transcription + visual analysis...");

    const { file, hasAudio, audioPath, duration, tempFiles, ...rest } = inputData;
    const videoPath = path.join(WORKSPACE_PATH, file);

    // Run transcription and visual analysis concurrently
    const [segments, scenes] = await Promise.all([
      // Transcription
      (async (): Promise<TranscriptionSegment[]> => {
        if (!hasAudio || !audioPath) {
          console.log("[transcribeAndAnalyzeStep] No audio detected, skipping transcription");
          return [];
        }
        try {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            throw new Error("OPENAI_API_KEY environment variable is not set");
          }
          const result = await transcribeChunk(apiKey, audioPath, 0);
          console.log(`[transcribeAndAnalyzeStep] Transcription complete: ${result.length} segments`);
          return result;
        } catch (error: any) {
          console.error("[transcribeAndAnalyzeStep] Transcription failed:", error.message);
          throw new Error(`Failed to transcribe audio: ${error.message}`);
        }
      })(),

      // Visual analysis
      (async (): Promise<VisualScene[]> => {
        try {
          const videoDuration = await getVideoDuration(videoPath);
          let detected = await detectScenesWithFallback(videoPath, 0.3, videoDuration);
          if (detected.length === 0) {
            console.log("[transcribeAndAnalyzeStep] No scenes detected, using uniform fallback");
            detected = createUniformScenes(videoDuration);
          }
          console.log(`[transcribeAndAnalyzeStep] Visual analysis complete: ${detected.length} scenes`);
          return detected;
        } catch (error: any) {
          console.error("[transcribeAndAnalyzeStep] Visual analysis failed:", error.message);
          throw new Error(`Failed to analyze visual content: ${error.message}`);
        }
      })(),
    ]);

    console.log(`[transcribeAndAnalyzeStep] Both tasks complete: ${segments.length} segments, ${scenes.length} scenes`);

    return {
      ...rest,
      file,
      audioPath,
      duration,
      hasAudio,
      segments,
      scenes,
      tempFiles,
    };
  },
});

// ============================================================================
// Step 5: Score Clips
// ============================================================================

const scoreStep = createStep({
  id: "score-clips",
  description: "Score moments using weighted algorithm",
  inputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    tempFiles: z.array(z.string()),
  }),
  outputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    moments: z.array(momentSchema),
    tempFiles: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    console.log("[scoreStep] Starting clip scoring...");
    
    const { segments, scenes, contentType, duration, tempFiles, ...rest } = inputData;
    
    try {
      // Delegate to the shared scoreClips function which handles:
      // - unified moment creation (segment-based, not micro-fragmented)
      // - corpus-level statistics for text and visual scoring
      // - multi-signal text scoring (density, vocabulary, length, coverage)
      // - min-max normalized visual scoring
      // - weighted combination and sorting
      const moments = scoreClips(segments, scenes, contentType, duration);
      
      console.log(`[scoreStep] Scoring complete: ${moments.length} moments ranked`);
      
      return {
        ...rest,
        contentType,
        duration,
        segments,
        scenes,
        moments,
        tempFiles,
      };
    } catch (error: any) {
      console.error("[scoreStep] Scoring failed:", error.message);
      throw new Error(`Failed to score clips: ${error.message}`);
    }
  },
});

// ============================================================================
// Step 6: Select Clips (HITL with LLM)
// ============================================================================

const selectStep = createStep({
  id: "select-clips",
  description: "Use LLM to select optimal clips from scored moments",
  inputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    moments: z.array(momentSchema),
    tempFiles: z.array(z.string()),
  }),
  suspendSchema: z.object({
    message: z.string(),
    proposedClips: z.array(z.object({
      start: z.number(),
      end: z.number(),
      reason: z.string(),
    })),
    moments: z.array(momentSchema),
    config: z.object({
      numberOfClips: z.number(),
      targetDuration: z.number(),
      contentType: z.string(),
    }),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    modifiedClips: z.array(z.object({
      start: z.number(),
      end: z.number(),
    })).optional(),
  }),
  outputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    moments: z.array(momentSchema),
    selectedClips: z.array(z.object({
      start: z.number(),
      end: z.number(),
      reason: z.string(),
    })),
    tempFiles: z.array(z.string()),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    console.log("[selectStep] Starting clip selection...");
    
    const {
      file,
      numberOfClips,
      targetDuration,
      contentType,
      outputFolder,
      startedAt,
      audioPath,
      duration,
      hasAudio,
      segments,
      scenes,
      moments,
      tempFiles,
    } = inputData;
    
    if (!resumeData) {
      console.log("[selectStep] Using LLM to select clips...");
      
      const prompt = buildClipSelectionPrompt({
        videoDuration: duration,
        numberOfClips,
        targetDuration,
        contentType,
        moments: moments.slice(0, 20),
      });
      
      let selectedClips: Array<{ start: number; end: number; reason: string }> = [];
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          const content = await callLLMForClipSelection(prompt);
          selectedClips = parseLLMResponse(content);
          
          if (validateClips(selectedClips, numberOfClips, targetDuration, duration)) {
            break;
          }
          
          console.log(`[selectStep] Invalid clip format, retrying (${attempts + 1}/${maxAttempts})...`);
        } catch (error) {
          console.error(`[selectStep] LLM parsing error: ${error}`);
        }
        attempts++;
      }
      
      if (selectedClips.length === 0) {
        console.log("[selectStep] Using algorithmic fallback for clip selection");
        selectedClips = selectClipsAlgorithmically(moments, numberOfClips, targetDuration, duration);
      }
      
      selectedClips = resolveOverlappingClips(selectedClips);
      
      console.log(`[selectStep] Selected ${selectedClips.length} clips, suspending for approval...`);
      
      return await suspend({
        message: "Please review the proposed highlight clips and approve or modify them.",
        proposedClips: selectedClips,
        moments: moments.slice(0, 10),
        config: {
          numberOfClips,
          targetDuration,
          contentType,
        },
      });
    }
    
    // Process user response
    let finalClips: Array<{ start: number; end: number; reason: string }>;
    
    if (!resumeData.approved) {
      throw new Error("User cancelled clip generation");
    }
    
    if (resumeData.modifiedClips && resumeData.modifiedClips.length > 0) {
      console.log("[selectStep] Using user-modified clips");
      finalClips = resumeData.modifiedClips.map((clip, index) => ({
        start: clip.start,
        end: clip.end,
        reason: `User-selected clip ${index + 1}`,
      }));
    } else {
      // User approved without modifications and resume tool forwarded
      // the LLM-proposed clips as modifiedClips. If that didn't happen
      // (e.g. direct API resume), fall back to algorithmic selection.
      console.log("[selectStep] User approved proposed clips, using algorithmic fallback");
      finalClips = selectClipsAlgorithmically(moments, numberOfClips, targetDuration, duration);
      finalClips = resolveOverlappingClips(finalClips);
    }
    
    console.log(`[selectStep] Final clips approved: ${finalClips.length} clips`);
    
    return {
      file,
      numberOfClips,
      targetDuration,
      contentType,
      outputFolder,
      startedAt,
      audioPath,
      duration,
      hasAudio,
      segments,
      scenes,
      moments,
      selectedClips: finalClips,
      tempFiles,
    };
  },
});

// ============================================================================
// Step 7: Generate Clips
// ============================================================================

const generateClipsStep = createStep({
  id: "generate-clips",
  description: "Extract video clips at selected timestamps",
  inputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    moments: z.array(momentSchema),
    selectedClips: z.array(z.object({
      start: z.number(),
      end: z.number(),
      reason: z.string(),
    })),
    tempFiles: z.array(z.string()),
  }),
  outputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    moments: z.array(momentSchema),
    selectedClips: z.array(z.object({
      start: z.number(),
      end: z.number(),
      reason: z.string(),
    })),
    generatedClips: z.array(generatedClipSchema),
    failedClips: z.array(failedClipSchema),
    tempFiles: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    console.log("[generateClipsStep] Starting clip generation...");
    
    const {
      file,
      outputFolder,
      selectedClips,
      duration,
      tempFiles,
      ...rest
    } = inputData;
    
    const videoPath = path.join(WORKSPACE_PATH, file);
    const outputFolderPath = path.join(WORKSPACE_PATH, outputFolder);
    
    if (!fs.existsSync(outputFolderPath)) {
      fs.mkdirSync(outputFolderPath, { recursive: true });
    }
    
    const generatedClips: Array<{ filename: string; path: string; duration: number }> = [];
    const failedClips: Array<{ start: number; end: number; error: string }> = [];
    
    for (let i = 0; i < selectedClips.length; i++) {
      const clip = selectedClips[i];
      
      if (!clip) continue;
      
      const filename = `clip_${String(i + 1).padStart(3, "0")}.mp4`;
      const outputPath = path.join(outputFolderPath, filename);
      
      const start = Math.max(0, clip.start);
      const end = Math.min(duration, clip.end);
      
      try {
        await withRetry(
          () => generateSingleClip(videoPath, outputPath, start, end),
          2,
          RETRY_DELAY_MS
        );
        
        const clipDuration = end - start;
        generatedClips.push({
          filename,
          path: outputPath,
          duration: clipDuration,
        });
        
        console.log(`[generateClipsStep] Generated clip ${i + 1}/${selectedClips.length}: ${filename}`);
      } catch (error: any) {
        console.error(`[generateClipsStep] Failed to generate clip ${i + 1}:`, error.message);
        
        try {
          const adjustedStart = Math.max(0, start - CLIP_RETRY_ADJUSTMENT);
            const adjustedEnd = Math.min(duration, end + CLIP_RETRY_ADJUSTMENT);
          
          if (adjustedEnd > adjustedStart) {
            await generateSingleClip(videoPath, outputPath, adjustedStart, adjustedEnd);
            generatedClips.push({
              filename,
              path: outputPath,
              duration: adjustedEnd - adjustedStart,
            });
            console.log(`[generateClipsStep] Generated clip with adjusted timestamps: ${filename}`);
          } else {
            throw new Error("Adjusted timestamps invalid");
          }
        } catch (retryError: any) {
          failedClips.push({
            start: clip.start,
            end: clip.end,
            error: error.message,
          });
        }
      }
    }
    
    console.log(`[generateClipsStep] Generated ${generatedClips.length} clips, ${failedClips.length} failed`);
    
    return {
      ...rest,
      file,
      outputFolder,
      audioPath: inputData.audioPath,
      duration,
      hasAudio: inputData.hasAudio,
      segments: inputData.segments,
      scenes: inputData.scenes,
      moments: inputData.moments,
      selectedClips,
      generatedClips,
      failedClips,
      tempFiles,
    };
  },
});

// ============================================================================
// Step 8: Cleanup
// ============================================================================

const cleanupStep = createStep({
  id: "cleanup",
  description: "Clean up temporary files",
  inputSchema: z.object({
    file: z.string(),
    numberOfClips: z.number(),
    targetDuration: z.number(),
    contentType: z.enum(["visual", "textual"]),
    outputFolder: z.string(),
    startedAt: z.number(),
    audioPath: z.string(),
    duration: z.number(),
    hasAudio: z.boolean(),
    segments: z.array(transcriptionSegmentSchema),
    scenes: z.array(visualSceneSchema),
    moments: z.array(momentSchema),
    selectedClips: z.array(z.object({
      start: z.number(),
      end: z.number(),
      reason: z.string(),
    })),
    generatedClips: z.array(generatedClipSchema),
    failedClips: z.array(failedClipSchema),
    tempFiles: z.array(z.string()),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    outputFolder: z.string(),
    clipsGenerated: z.number(),
    clips: z.array(generatedClipSchema),
    originalVideo: z.string(),
    processingTime: z.number(),
    cleanupReport: z.object({
      success: z.boolean(),
      deletedFiles: z.array(z.string()),
      failedFiles: z.array(z.object({
        path: z.string(),
        error: z.string(),
      })),
    }),
  }),
  execute: async ({ inputData }) => {
    console.log("[cleanupStep] Starting cleanup...");
    
    const {
      file,
      outputFolder,
      startedAt,
      generatedClips,
      tempFiles,
    } = inputData;
    
    const processingTime = Math.round((Date.now() - startedAt) / 1000);
    
    const result = removeFiles(tempFiles);
    
    console.log(`[cleanupStep] Cleanup complete. Deleted ${result.deleted.length} files`);
    
    return {
      success: generatedClips.length > 0,
      outputFolder,
      clipsGenerated: generatedClips.length,
      clips: generatedClips,
      originalVideo: file,
      processingTime,
      cleanupReport: {
        success: result.failed.length === 0,
        deletedFiles: result.deleted,
        failedFiles: result.failed,
      },
    };
  },
});

// ============================================================================
// Workflow Definition
// ============================================================================

export const smartHighlightsClipperWorkflow = createWorkflow({
  id: "smart-highlights-clipper",
  description: "Intelligently extracts highlight clips from videos using AI-powered analysis of audio and visual content",
  inputSchema: configStepInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    outputFolder: z.string(),
    clipsGenerated: z.number(),
    clips: z.array(generatedClipSchema),
    originalVideo: z.string(),
    processingTime: z.number(),
    cleanupReport: z.object({
      success: z.boolean(),
      deletedFiles: z.array(z.string()),
      failedFiles: z.array(z.object({
        path: z.string(),
        error: z.string(),
      })),
    }),
  }),
})
  .then(configStep)
  .then(extractAudioStep)
  .then(transcribeAndAnalyzeStep)
  .then(scoreStep)
  .then(selectStep)
  .then(generateClipsStep)
  .then(cleanupStep)
  .commit();
