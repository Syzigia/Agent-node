import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { WORKSPACE_PATH, sanitizePath } from "../../../workspace";

export const convertToWebpTool = createTool({
  id: "convert-to-webp",
  description: `Converts a list of images to WebP, generating COPIES. Originals are NEVER modified or deleted.
First use list_files to get exact paths, then pass all the files you want to convert in a single call.
Examples:
- One image:    { files: ["photo.jpg"] }
- Multiple:     { files: ["img/banner.png", "img/hero.jpg", "logo.png"] }
- With quality: { files: ["photo.jpg"], quality: 90 }`,
  inputSchema: z.object({
    files: z
      .array(z.string())
      .min(1)
      .describe("Array of relative paths within the workspace for files to convert"),
    quality: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(85)
      .describe("WebP quality from 1 to 100 (default: 85)"),
  }),
  execute: async ({ files, quality }) => {
    const results: Array<{
      original: string;
      webp: string;
      sizeOriginal: number;
      sizeWebp: number;
      reduction: string;
    }> = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const rawFile of files) {
      const relFile = sanitizePath(rawFile);
      const srcPath = path.join(WORKSPACE_PATH, relFile);

      if (!fs.existsSync(srcPath)) {
        errors.push({ file: relFile, error: "File not found" });
        continue;
      }

      const webpRel = relFile.replace(/\.[^.]+$/, ".webp");
      const destPath = path.join(WORKSPACE_PATH, webpRel);

      if (srcPath === destPath) {
        errors.push({
          file: relFile,
          error: "File is already .webp, skipped to avoid overwriting",
        });
        continue;
      }

      try {
        await sharp(srcPath).webp({ quality }).toFile(destPath);

        if (!fs.existsSync(srcPath)) {
          errors.push({
            file: relFile,
            error: "Critical error: original disappeared after conversion",
          });
          continue;
        }

        const sizeOriginal = fs.statSync(srcPath).size;
        const sizeWebp = fs.statSync(destPath).size;
        const reduction = (((sizeOriginal - sizeWebp) / sizeOriginal) * 100).toFixed(1);

        results.push({
          original: relFile,
          webp: webpRel,
          sizeOriginal,
          sizeWebp,
          reduction: `${reduction}%`,
        });
      } catch (err: any) {
        errors.push({ file: relFile, error: err.message });
      }
    }

    return {
      success: results.length > 0,
      converted: results.length,
      failed: errors.length,
      results,
      errors,
    };
  },
});
