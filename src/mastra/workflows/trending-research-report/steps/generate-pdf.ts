import { createStep } from "@mastra/core/workflows"
import z from "zod"
import PDFDocument from "pdfkit"
import * as fs from "fs"
import * as path from "path"

export const generatePDFStep = createStep({
  id: "generate-pdf",
  inputSchema: z.object({
    subtitles: z.array(z.string()),
    contents: z.array(z.string()),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    pdfPath: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const filename = `trending-research-report-${timestamp}.pdf`
      const outputPath = path.join(process.cwd(), "output", filename)

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      // Generate PDF
      const doc = new PDFDocument({ margin: 72 })
      const stream = fs.createWriteStream(outputPath)
      doc.pipe(stream)

      // Add title
      doc
        .font("Times-Bold")
        .fontSize(24)
        .text("Trending Research Report", { align: "center" })

      doc.moveDown(2)

      // Add content sections
      inputData.subtitles.forEach((subtitle, index) => {
        doc.font("Times-Bold").fontSize(18).text(subtitle, { underline: true })

        doc.moveDown(0.5)

        doc
          .font("Times-Roman")
          .fontSize(12)
          .text(inputData.contents[index], { align: "justify" })

        doc.moveDown(1.5)
      })

      doc.end()

      // Wait for file to be written
      await new Promise<void>((resolve, reject) => {
        stream.on("finish", resolve)
        stream.on("error", reject)
      })

      return {
        success: true,
        pdfPath: outputPath,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: errorMessage,
      }
    }
  },
})
