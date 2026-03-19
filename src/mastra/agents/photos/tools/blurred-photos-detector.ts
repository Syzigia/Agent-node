import { Tool } from "@mastra/core/tools";
import sharp from "sharp";
import z from "zod";
import { sanitizePath, WORKSPACE_PATH } from "../../../workspace";
import path from "node:path";
import fs from "node:fs";

type blurTestResult = {
    blurScore: number;
    isBlurred: boolean
}

type errorResult = {
    file: string;
    error: any;
}

async function detectBlur(imageInput: string, threshold: number = 100): Promise<blurTestResult | errorResult> {
    try {
        const { data } = await sharp(imageInput)
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
            sum += data[i];
        }
        const mean = sum / totalPixels;

        let varianceSum = 0;
        for (let i = 0; i < totalPixels; i++) {
            varianceSum += Math.pow(data[i] - mean, 2);
        }

        const variance = varianceSum / totalPixels;

        return {
            blurScore: variance,
            isBlurred: variance < threshold
        }
    }

    catch (error) {
        return {
            file: imageInput,
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
        const thresholdValue = threshold === "low" ? 50 : threshold === "high" ? 250 : 100;

        const blurryDir = path.join(WORKSPACE_PATH, "blurry_photos");
        fs.mkdirSync(blurryDir, { recursive: true });

        for (const rawFile of files) {
            let relFile: string;

            try {
                relFile = sanitizePath(rawFile);
            } catch (err: any) {
                errors.push({ file: rawFile, error: err.message });
                continue;
            }

            const srcPath = path.join(WORKSPACE_PATH, relFile);

            if (!fs.existsSync(srcPath)) {
                errors.push({ file: relFile, error: "File not found in workspace" });
                continue;
            }

            const result = await detectBlur(srcPath, thresholdValue);

            if ("error" in result) {
                errors.push({ file: relFile, error: String(result.error) });
            } else {
                results.push({ file: relFile, blurScore: result.blurScore, isBlurred: result.isBlurred });

                if (result.isBlurred) {
                    fs.renameSync(srcPath, path.join(blurryDir, path.basename(relFile)));
                }
            }
        }

        return {
            results: {
                success: results.length > 0,
                processed: results.length,
                failed: errors.length,
                results,
                errors,
            },
        };
    }
})