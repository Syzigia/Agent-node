import { Tool } from "@mastra/core/tools";
import z from "zod";
import pLimit from "p-limit";
import { s3Filesystem } from "../../../workspace/s3";
import { createRequire } from "node:module";
import sharp from "sharp";
import canvas from "canvas";

const CONCURRENCY = 5;
const BATCH_TIMEOUT_MS = 240_000;

const _require = createRequire(import.meta.url);

// Lazy-loaded references
let faceapi: any = null;
let modelsLoaded = false;

async function loadModels() {
  if (!modelsLoaded) {
    faceapi = _require("@vladmandic/face-api/dist/face-api.node-wasm.js");

    const { Canvas, Image, ImageData } = canvas;
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

    await faceapi.tf.setBackend("wasm");
    await faceapi.tf.ready();

    const modelPath = (await import("node:path")).join(
      (await import("node:path")).dirname(_require.resolve("@vladmandic/face-api/package.json")),
      "model",
    );
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);

    modelsLoaded = true;
  }
  return faceapi;
}

interface Point {
  x: number;
  y: number;
}

function calculateEAR(eyePoints: Point[]): number {
  // EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
  // 68-landmark model eye points: [outer_corner, upper_outer, upper_inner, inner_corner, lower_inner, lower_outer]
  const p1 = eyePoints[0]!;
  const p2 = eyePoints[1]!;
  const p3 = eyePoints[2]!;
  const p4 = eyePoints[3]!;
  const p5 = eyePoints[4]!;
  const p6 = eyePoints[5]!;

  const vertical1 = Math.sqrt(Math.pow(p2.x - p6.x, 2) + Math.pow(p2.y - p6.y, 2));
  const vertical2 = Math.sqrt(Math.pow(p3.x - p5.x, 2) + Math.pow(p3.y - p5.y, 2));
  const horizontal = Math.sqrt(Math.pow(p1.x - p4.x, 2) + Math.pow(p1.y - p4.y, 2));

  return (vertical1 + vertical2) / (2 * horizontal);
}

async function detectClosedEyes(imageBuffer: Buffer, threshold: number): Promise<{
  hasClosedEyes: boolean;
  leftEyeEAR: number;
  rightEyeEAR: number;
  faceCount: number;
} | { error: any }> {
  try {
    const faceapi = await loadModels();

    // Convert to PNG buffer via sharp to support all formats (webp, tiff, etc.)
    const pngBuffer = await sharp(imageBuffer).png().toBuffer();
    const img = await canvas.loadImage(pngBuffer);
    const c = new canvas.Canvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const detections = await faceapi.detectAllFaces(c).withFaceLandmarks();

    if (!detections || detections.length === 0) {
      return { error: "No faces detected in image" };
    }

    let hasClosedEyes = false;
    let totalLeftEAR = 0;
    let totalRightEAR = 0;

    for (const detection of detections) {
      const landmarks = detection.landmarks;
      const leftEye: Point[] = landmarks.getLeftEye();
      const rightEye: Point[] = landmarks.getRightEye();

      const leftEAR = calculateEAR(leftEye);
      const rightEAR = calculateEAR(rightEye);

      totalLeftEAR += leftEAR;
      totalRightEAR += rightEAR;

      if (leftEAR < threshold || rightEAR < threshold) {
        hasClosedEyes = true;
      }
    }

    return {
      hasClosedEyes,
      leftEyeEAR: totalLeftEAR / detections.length,
      rightEyeEAR: totalRightEAR / detections.length,
      faceCount: detections.length,
    };
  } catch (error) {
    return { error };
  }
}

export const closedEyesDetectorTool = new Tool({
  id: "closed-eyes-detector",
  description: `Detects photos with closed eyes from a list of image files.

    Accepts one or more image files and a threshold for eye openness detection (sensitive: 0.15, normal: 0.20, relaxed: 0.25) and returns which photos have people with closed eyes. The photos with closed eyes are moved to a folder called "eyes_closed". Supported formats: jpg, jpeg, png, webp, tiff.

    EAR (Eye Aspect Ratio) explanation:
    - EAR > 0.25: Eyes are open
    - EAR 0.20-0.25: Eyes partially closed
    - EAR < 0.20: Eyes are closed

    Examples input:
    1. Single photo:
    {
      "files": ["photo1.jpg"],
      "threshold": "normal"
    }
    2. Multiple photos:
    {
      "files": ["photo1.jpg", "photo2.png", "photo3.webp"],
      "threshold": "sensitive"
    }
  `,
  inputSchema: z.object({
    files: z.array(z.string()),
    threshold: z.enum(["sensitive", "normal", "relaxed"]).default("normal").optional(),
  }),
  outputSchema: z.object({
    results: z.object({
      success: z.boolean(),
      processed: z.number(),
      failed: z.number(),
      skipped: z.number(),
      remaining: z.array(z.string()),
      results: z.array(
        z.object({
          file: z.string(),
          hasClosedEyes: z.boolean(),
          leftEyeEAR: z.number(),
          rightEyeEAR: z.number(),
          faceCount: z.number(),
        })
      ),
      errors: z.array(
        z.object({
          file: z.string(),
          error: z.string(),
        })
      ),
    }),
  }),
  execute: async ({ files, threshold }) => {
    const results: Array<{
      file: string;
      hasClosedEyes: boolean;
      leftEyeEAR: number;
      rightEyeEAR: number;
      faceCount: number;
    }> = [];
    const errors: Array<{ file: string; error: string }> = [];
    const skipped: string[] = [];
    const thresholdValue = threshold === "sensitive" ? 0.15 : threshold === "relaxed" ? 0.25 : 0.2;

    const limit = pLimit(CONCURRENCY);
    const start = Date.now();

    const promises = files.map(file =>
      limit(async () => {
        if (Date.now() - start > BATCH_TIMEOUT_MS) {
          skipped.push(file);
          return;
        }

        try {
          const exists = await s3Filesystem.exists(file);
          if (!exists) {
            errors.push({ file, error: "File not found in S3" });
            return;
          }

          const buffer = await s3Filesystem.readFile(file) as Buffer;
          const result = await detectClosedEyes(buffer, thresholdValue);

          if ("error" in result) {
            errors.push({ file, error: String(result.error) });
          } else {
            results.push({
              file,
              hasClosedEyes: result.hasClosedEyes,
              leftEyeEAR: result.leftEyeEAR,
              rightEyeEAR: result.rightEyeEAR,
              faceCount: result.faceCount,
            });

            if (result.hasClosedEyes) {
              const fileName = file.split("/").pop() || file;
              const destPath = `eyes_closed/${fileName}`;
              await s3Filesystem.moveFile(file, destPath);
            }
          }
        } catch (err: any) {
          errors.push({ file, error: err.message });
        }
      })
    );

    await Promise.all(promises);

    return {
      results: {
        success: results.length > 0,
        processed: results.length,
        failed: errors.length,
        skipped: skipped.length,
        remaining: skipped,
        results,
        errors,
      },
    };
  },
});
