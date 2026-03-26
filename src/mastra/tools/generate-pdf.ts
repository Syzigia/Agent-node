import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import PDFDocument from "pdfkit"
import { getFilesystem } from "../workspace/context"

interface ImageData {
  id: string
  url: string
  caption: string
  photographer: string
  photographerUrl: string
  color: string
}

interface ProcessedImage extends ImageData {
  buffer: Buffer
}

export const generatePdfTool = createTool({
  id: "generate-pdf",
  description:
    "Generates a PDF document with text content and images, saves it to the workspace reports folder",
  inputSchema: z.object({
    filename: z
      .string()
      .describe("Name of the PDF file to create (without extension)"),
    title: z.string().describe("Main title of the document"),
    subtitles: z
      .array(z.string())
      .describe("Array of section subtitles/headings"),
    contents: z
      .array(z.string())
      .describe("Array of section contents (must match subtitles length)"),
    images: z
      .array(
        z.object({
          id: z.string(),
          url: z.string(),
          caption: z.string().optional().default(""),
          photographer: z.string().optional().default("Unknown"),
          photographerUrl: z.string().optional().default(""),
          color: z.string().optional().default("#000000"),
        })
      )
      .optional()
      .describe("Array of images to include in the PDF"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    filePath: z
      .string()
      .optional()
      .describe("Relative path to the generated PDF in the workspace"),
    error: z.string().optional(),
    imageStats: z.string().optional(),
  }),
  execute: async (
    { filename, title, subtitles, contents, images },
    context
  ) => {
    try {
      const filesystem = getFilesystem(context)
      const safeFilename = `${filename.replace(/[^a-zA-Z0-9-_]/g, "-")}.pdf`
      const filePath = `reports/${safeFilename}`

      // Ensure reports directory exists
      try {
        await filesystem.readdir("reports")
      } catch {
        await filesystem.writeFile("reports/.keep", Buffer.from(""))
      }

      console.log(`[generate-pdf] Starting PDF: ${filePath}`)
      console.log(`[generate-pdf] Images received: ${images?.length ?? 0}`)
      if (images && images.length > 0) {
        images.forEach((img, i) => {
          console.log(
            `[generate-pdf] Image ${i}: id=${img.id}, url=${img.url?.substring(0, 60)}..., photographer=${img.photographer}`
          )
        })
      }

      // Process images: fetch and convert to buffer for PDFKit
      const processedImages: ProcessedImage[] = []

      if (images && images.length > 0) {
        for (const img of images) {
          if (!img.url) {
            console.error(`[generate-pdf] Image ${img.id}: no URL, skipping`)
            continue
          }

          try {
            console.log(
              `[generate-pdf] Fetching image ${img.id}: ${img.url.substring(0, 60)}...`
            )
            const imageResponse = await fetch(img.url)
            if (!imageResponse.ok) {
              console.error(
                `[generate-pdf] Image ${img.id}: fetch failed with status ${imageResponse.status}`
              )
              continue
            }

            const contentType =
              imageResponse.headers.get("content-type") || ""
            const arrayBuffer = await imageResponse.arrayBuffer()
            const imageBuffer = Buffer.from(arrayBuffer)

            console.log(
              `[generate-pdf] Image ${img.id}: fetched ${imageBuffer.length} bytes, type=${contentType}`
            )

            if (imageBuffer.length < 100) {
              console.error(
                `[generate-pdf] Image ${img.id}: buffer too small (${imageBuffer.length} bytes), skipping`
              )
              continue
            }

            processedImages.push({
              ...img,
              caption: img.caption || "",
              photographer: img.photographer || "Unknown",
              photographerUrl: img.photographerUrl || "",
              color: img.color || "#000000",
              buffer: imageBuffer,
            })
            console.log(
              `[generate-pdf] Image ${img.id}: processed successfully`
            )
          } catch (fetchError) {
            console.error(
              `[generate-pdf] Image ${img.id}: error -`,
              fetchError instanceof Error
                ? fetchError.message
                : String(fetchError)
            )
            continue
          }
        }
      }

      console.log(
        `[generate-pdf] Successfully processed ${processedImages.length}/${images?.length ?? 0} images`
      )

      // Generate PDF to buffer
      const chunks: Buffer[] = []
      const doc = new PDFDocument({ margin: 72 })

      doc.on("data", (chunk: Buffer) => chunks.push(chunk))

      // Portada con título
      doc.font("Times-Bold").fontSize(28).text(title, { align: "center" })
      doc.moveDown(2)

      // Si hay imágenes, mostrar una hero en la portada
      if (processedImages.length > 0) {
        try {
          doc.image(processedImages[0].buffer, {
            fit: [450, 300],
            align: "center",
          })
          doc.moveDown(0.5)
          doc
            .font("Times-Italic")
            .fontSize(10)
            .text(
              `Foto por ${processedImages[0].photographer} en Unsplash`,
              { align: "center" }
            )
          doc.moveDown(2)
          console.log("[generate-pdf] Hero image embedded in cover page")
        } catch (imgError) {
          console.error(
            "[generate-pdf] Failed to embed hero image:",
            imgError instanceof Error ? imgError.message : String(imgError)
          )
        }
      }

      doc.addPage()

      // Contenido principal
      subtitles.forEach((subtitle, index) => {
        if (index > 0) {
          doc.addPage()
        }

        // Título de sección
        doc.font("Times-Bold").fontSize(20).text(subtitle)
        doc.moveDown(0.8)

        // Contenido de la sección
        doc
          .font("Times-Roman")
          .fontSize(12)
          .text(contents[index] || "", {
            align: "justify",
            lineGap: 4,
          })

        // Agregar imagen relevante si existe
        const sectionImage = processedImages[index + 1]
        if (sectionImage) {
          doc.moveDown(1.5)

          try {
            doc.image(sectionImage.buffer, {
              fit: [400, 250],
              align: "center",
            })

            doc.moveDown(0.5)
            doc
              .font("Times-Italic")
              .fontSize(9)
              .text(sectionImage.caption, { align: "center" })
            doc
              .font("Times-Italic")
              .fontSize(8)
              .text(
                `Foto por ${sectionImage.photographer} en Unsplash`,
                { align: "center" }
              )
            console.log(
              `[generate-pdf] Section ${index} image embedded`
            )
          } catch (imgError) {
            console.error(
              `[generate-pdf] Failed to embed section ${index} image:`,
              imgError instanceof Error
                ? imgError.message
                : String(imgError)
            )
          }
        }

        doc.moveDown(1)
      })

      // Página final: Moodboard con todas las imágenes
      if (processedImages.length > 1) {
        doc.addPage()
        doc.font("Times-Bold").fontSize(18).text("Moodboard de Referencias", {
          align: "center",
        })
        doc.moveDown(1)

        // Grid de imágenes (2 columnas)
        let currentX = 72
        let currentY = doc.y
        const colWidth = 230
        const imgHeight = 150
        const gap = 20

        processedImages.slice(1).forEach((img, i) => {
          try {
            // Calcular posición
            if (i % 2 === 0 && i > 0) {
              currentX = 72
              currentY += imgHeight + 60
            } else if (i % 2 === 1) {
              currentX = 72 + colWidth + gap
            }

            // Verificar si necesitamos nueva página
            if (currentY + imgHeight > doc.page.height - 100) {
              doc.addPage()
              currentY = 72
              currentX = i % 2 === 0 ? 72 : 72 + colWidth + gap
            }

            doc.image(img.buffer, currentX, currentY, {
              fit: [colWidth, imgHeight],
            })

            // Caption debajo
            doc
              .font("Times-Italic")
              .fontSize(7)
              .text(
                `Foto por ${img.photographer}`,
                currentX,
                currentY + imgHeight + 5,
                {
                  width: colWidth,
                  align: "center",
                }
              )
          } catch (imgError) {
            console.error(
              `[generate-pdf] Moodboard image ${i} failed:`,
              imgError instanceof Error
                ? imgError.message
                : String(imgError)
            )
          }
        })
      }

      doc.end()

      // Wait for PDF generation to complete
      await new Promise<void>((resolve, reject) => {
        doc.on("end", resolve)
        doc.on("error", reject)
      })

      const pdfBuffer = Buffer.concat(chunks)

      // Save to workspace filesystem in reports folder
      await filesystem.writeFile(filePath, pdfBuffer)

      const stats = `${processedImages.length}/${images?.length ?? 0} images embedded`
      console.log(`[generate-pdf] PDF saved: ${filePath} (${pdfBuffer.length} bytes, ${stats})`)

      return {
        success: true,
        filePath: filePath,
        imageStats: stats,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error(`[generate-pdf] Fatal error: ${errorMessage}`)
      return {
        success: false,
        error: errorMessage,
      }
    }
  },
})
