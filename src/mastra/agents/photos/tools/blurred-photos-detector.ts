import { Tool } from "@mastra/core/tools";
import sharp from "sharp";
import z from "zod";
import pLimit from "p-limit";
import { s3Filesystem } from "../../../workspace/s3";
import type { errorResult } from "./types";

const CONCURRENCY = 5;
const BATCH_TIMEOUT_MS = 240_000; // 4 min safety margin

type blurTestResult = {
    blurScore: number;
    isBlurred: boolean
}

async function detectBlur(imageBuffer: Buffer, threshold: number = 100): Promise<blurTestResult | errorResult> {
    try {
        const { data } = await sharp(imageBuffer)
            .greyscale()
            .convolve({
                width: 3,
                height: 3,
                kernel: [
                    0, 1, 0,
                    1, -4, 1,
                    0, 1, 0
                ]
            })
            .raw()
            .toBuffer({ resolveWithObject: true });

        let sum = 0;
        const totalPixels = data.length;
        for (let i = 0; i < totalPixels; i++) {
            sum += data[i]!;
        }
        const mean = sum / totalPixels;

        let varianceSum = 0;
        for (let i = 0; i < totalPixels; i++) {
            varianceSum += Math.pow(data[i]! - mean, 2);
        }

        const variance = varianceSum / totalPixels;

        return {
            blurScore: variance,
            isBlurred: variance < threshold
        }
    }

    catch (error) {
        return {
            file: "buffer",
            error: error
        };
    }
}

export const blurredPhotosDetectorTool = new Tool({
    id: "blurred-photos-detector",
    description: `Detects blurry photos from a list of image files.

    Accepts one or more image files and a threshold (Low: 50, normal: 100, high: 250) and returns which photos are blurry based on the variance of the Laplacian method. The blurry photos are moved to a folder called "blurry_photos". Supported formats: jpg, jpeg, png, webp, tiff.

    Examples input:
    1. Single photo:
    {
    "files": ["photo1.jpg"],
    "threshold": "normal"
    }
    2. Multiple photos:
    {
    "files": ["photo1.jpg", "photo2.png", "photo3.webp"],
    "threshold": "low"
    }
    `,
    inputSchema: z.object({
        files: z.array(z.string()),
        threshold: z.enum(["low", "normal", "high"]).default("normal").optional()
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
                    blurScore: z.number(),
                    isBlurred: z.boolean()
                })
            ),
            errors: z.array(
                z.object({
                    file: z.string(),
                    error: z.string()
                })
            )
        })
    }),
    execute: async ({ files, threshold }) => {
        const results: Array<{ file: string; blurScore: number; isBlurred: boolean }> = [];
        const errors: Array<{ file: string; error: string }> = [];
        const skipped: string[] = [];
        const thresholdValue = threshold === "low" ? 50 : threshold === "high" ? 250 : 100;

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
                    const result = await detectBlur(buffer, thresholdValue);

                    if ("error" in result) {
                        errors.push({ file, error: String(result.error) });
                    } else {
                        results.push({ file, blurScore: result.blurScore, isBlurred: result.isBlurred });

                        if (result.isBlurred) {
                            const fileName = file.split("/").pop() || file;
                            const destPath = `blurry_photos/${fileName}`;
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
    }
})
