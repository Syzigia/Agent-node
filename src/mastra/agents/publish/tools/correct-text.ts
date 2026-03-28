import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import PDFDocument from "pdfkit"
import * as path from "path"
import * as fs from "fs"
import type { ToolExecutionContext } from "@mastra/core/tools"
import {
  getFilesystem,
  createTempWorkspace,
  uploadToS3,
  cleanupTempWorkspace,
} from "../../../workspace/context"

const OUTPUT_FOLDER = "corrected_copies"

export const correctTextTool = createTool({
  id: "correct-text",
  description: `Saves corrected text as a PDF file in the corrected_copies folder.
The agent should provide the already-corrected text. This tool handles PDF generation and workspace storage only.`,
  inputSchema: z.object({
    text: z.string().min(1).describe("The corrected text to save as PDF"),
    filename: z
      .string()
      .optional()
      .default("corrected")
      .describe("Output PDF filename without extension (default: 'corrected')"),
  }),
  execute: async ({ text, filename }, context: ToolExecutionContext) => {
    const filesystem = getFilesystem(context)

    const safeName = (filename ?? "corrected").replace(
      /[^a-zA-Z0-9_\-. ]/g,
      "_"
    )
    const pdfFileName = `${safeName}.pdf`
    const pdfPath = `${OUTPUT_FOLDER}/${pdfFileName}`
    const tempDir = createTempWorkspace()
    const localPdfPath = path.join(tempDir, pdfFileName)

    try {
      await new Promise<void>((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 })
        const chunks: Buffer[] = []

        doc.on("data", (chunk: Buffer) => chunks.push(chunk))
        doc.on("end", () => {
          const pdfBuffer = Buffer.concat(chunks)
          const dir = path.dirname(localPdfPath)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
          fs.writeFileSync(localPdfPath, pdfBuffer)
          resolve()
        })
        doc.on("error", reject)

        doc
          .font("Helvetica")
          .fontSize(12)
          .text(text, { align: "left", lineGap: 4 })

        doc.end()
      })

      await uploadToS3(filesystem, localPdfPath, pdfPath)

      return {
        success: true,
        savedTo: pdfPath,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      }
    } finally {
      cleanupTempWorkspace(tempDir)
    }
  },
})
