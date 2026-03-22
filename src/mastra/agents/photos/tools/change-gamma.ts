import { Tool } from "@mastra/core/tools";
import sharp from "sharp";
import z from "zod";
import pLimit from "p-limit";
import { getFilesystem } from "../../../workspace/context";
import type { errorResult } from "./types";

const CONCURRENCY = 5;
const BATCH_TIMEOUT_MS = 240_000;

enum gammaValue {
    APPLE = "apple",
    SRGB = "srgb",
    BROADCAST = "broadcast"
}

const gammaMap: Record<gammaValue, number> = {
    [gammaValue.APPLE]: 1.8,
    [gammaValue.SRGB]: 2.2,
    [gammaValue.BROADCAST]: 2.4
};

type gammaChangeResult = {
    file: string;
    value: gammaValue;
    outputPath: string;
}

async function changeGamma(imageBuffer: Buffer, gamma: gammaValue): Promise<Buffer | errorResult> {
    try {
        const outputBuffer = await sharp(imageBuffer)
            .gamma(gammaMap[gamma])
            .toBuffer();

        return outputBuffer;
    } catch (error) {
        return {
            file: "buffer",
            error
        }
    }
}

export const changeGammaTool = new Tool({
    id: "change-gamma",
    description: `Adjusts the gamma value of one or more images.

    Applies gamma correction to images using a specific gamma curve. The gamma value determines how the image brightness is adjusted.
    Processed images are saved to the "gamma_correction" folder by default.

    Available gamma curves:
    - "apple": Gamma 1.8 (used by older Apple displays and some print workflows)
    - "srgb": Gamma 2.2 (standard for sRGB color space, most common)
    - "broadcast": Gamma 2.4 (standard for HDTV and broadcast video)

    Examples input:
    1. Single photo:
    {
        "files": ["photo.jpg"],
        "gamma": "srgb"
    }
    2. Multiple photos:
    {
        "files": ["photo1.jpg", "photo2.png", "photo3.webp"],
        "gamma": "apple"
    }
    `,
    inputSchema: z.object({
        files: z.array(z.string()).describe("Array of paths to the input image files"),
        gamma: z.enum([gammaValue.APPLE, gammaValue.SRGB, gammaValue.BROADCAST]).describe("Gamma curve to apply (apple: 1.8, srgb: 2.2, broadcast: 2.4)")
    }),
    outputSchema: z.object({
        result: z.object({
            success: z.boolean(),
            processed: z.number(),
            failed: z.number(),
            skipped: z.number(),
            remaining: z.array(z.string()),
            results: z.array(
                z.object({
                    file: z.string(),
                    value: z.enum([gammaValue.APPLE, gammaValue.SRGB, gammaValue.BROADCAST]),
                    outputPath: z.string()
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
    execute: async ({ files, gamma }, context) => {
        const fs = getFilesystem(context);
        const results: Array<{ file: string; value: gammaValue; outputPath: string }> = [];
        const errors: Array<{ file: string; error: string }> = [];
        const skipped: string[] = [];

        const limit = pLimit(CONCURRENCY);
        const start = Date.now();

        const promises = files.map(file =>
            limit(async () => {
                if (Date.now() - start > BATCH_TIMEOUT_MS) {
                    skipped.push(file);
                    return;
                }

                try {
                    const exists = await fs.exists(file);
                    if (!exists) {
                        errors.push({ file, error: "File not found in S3" });
                        return;
                    }

                    const buffer = await fs.readFile(file) as Buffer;
                    const result = await changeGamma(buffer, gamma);

                    if (Buffer.isBuffer(result)) {
                        const fileName = file.split("/").pop() || file;
                        const outputPath = `gamma_correction/${fileName}`;
                        await fs.writeFile(outputPath, result);
                        results.push({ file, value: gamma, outputPath });
                    } else {
                        errors.push({ file, error: String(result.error) });
                    }
                } catch (err: any) {
                    errors.push({ file, error: err.message });
                }
            })
        );

        await Promise.all(promises);

        return {
            result: {
                success: results.length > 0,
                processed: results.length,
                failed: errors.length,
                skipped: skipped.length,
                remaining: skipped,
                results,
                errors
            }
        };
    }
});
