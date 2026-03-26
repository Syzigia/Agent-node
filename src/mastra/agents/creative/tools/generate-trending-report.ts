import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import {
  projectExamplesAgent,
  visualInspirationAgent,
  industryShowcaseAgent,
  creativeDirectionsAgent,
} from "../../../workflows/trending-research/agent"
import { writerAgent } from "../../../workflows/trending-research-report/agent"
import { generatePdfTool } from "../../../tools/generate-pdf"
import { searchUnsplashImagesTool } from "../../../tools/search-unsplash-images"

interface ImageData {
  id: string
  url: string
  description: string | null
  altDescription: string | null
  photographer: string
  photographerUrl: string
  color: string
}

interface SelectedImage {
  id: string
  reason: string
  placement: string
}

interface ImageForPdf {
  id: string
  url: string
  caption: string
  photographer: string
  photographerUrl: string
  color: string
  placement: string
}

export const generateTrendingReportTool = createTool({
  id: "generate-trending-report",
  description: `Generates a comprehensive design inspiration report on a given topic and creates a PDF with visual references.
    
This tool:
1. Researches the topic across 4 dimensions in parallel: projects, visual inspiration, industry examples, and creative directions
2. Searches for relevant inspiration images on Unsplash
3. Writes structured content with 3-6 sections
4. Generates a PDF report with integrated images and saves it to the workspace in the reports/ folder

Returns the report content and PDF file path.`,
  inputSchema: z.object({
    topic: z
      .string()
      .min(1)
      .describe("The topic to research and generate a report about"),
    projectType: z
      .string()
      .optional()
      .describe(
        "Type of project: web, mobile app, branding, packaging, illustration, etc."
      ),
    industry: z
      .string()
      .optional()
      .describe(
        "Client's industry: fintech, healthcare, fashion, food, education, etc."
      ),
    goals: z
      .string()
      .optional()
      .describe(
        "Project goals: simplify onboarding, increase conversions, modernize brand, etc."
      ),
    targetAudience: z
      .string()
      .optional()
      .describe(
        "Target audience: young professionals, Gen Z, seniors, B2B, etc."
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    topic: z.string(),
    subtitles: z.array(z.string()),
    contents: z.array(z.string()),
    pdfPath: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { topic, projectType, industry, goals, targetAudience },
    context
  ) => {
    try {
      // Build contextual search prompts based on available info
      const contextStr = [
        topic,
        projectType ? `tipo de proyecto: ${projectType}` : "",
        industry ? `industria: ${industry}` : "",
        goals ? `objetivo: ${goals}` : "",
        targetAudience ? `audiencia: ${targetAudience}` : "",
      ]
        .filter(Boolean)
        .join(", ")

      // Step 1: Run all 4 inspiration agents in parallel
      const [projectsResult, visualResult, industryResult, directionsResult] =
        await Promise.all([
          projectExamplesAgent.generate(
            `Busca proyectos de diseño inspiradores sobre "${topic}". ${projectType ? `Enfócate en ${projectType}.` : ""} ${industry ? `Prioriza ejemplos del sector ${industry}.` : ""}
          
Busca en: Behance, Dribbble, Awwwards, portfolios de diseñadores.

Presenta:
- Proyectos reales con resultados medibles
- Qué hace que cada proyecto sea especial
- Ideas prácticas que se pueden aplicar
- Enlaces o referencias cuando estén disponibles

Escribe de forma conversacional y entusiasta, como si compartieras hallazgos emocionantes con un colega diseñador.`
          ),
          visualInspirationAgent.generate(
            `Descubre tendencias visuales actuales para "${topic}". ${projectType ? `Aplica a ${projectType}.` : ""} ${targetAudience ? `Considera que la audiencia es ${targetAudience}.` : ""}
          
Busca:
- Paletas de colores que están funcionando ahora
- Combinaciones tipográficas modernas
- Estilos visuales frescos y layouts innovadores
- Elementos de UI que captan atención

Describe los elementos visuales de forma evocadora, ayudando al diseñador a visualizar las posibilidades. Sé específico pero inspirador.`
          ),
          industryShowcaseAgent.generate(
            `Investiga ejemplos del sector sobre "${topic}". ${industry ? `Enfócate específicamente en la industria ${industry}.` : "Identifica la industria más relevante y busca ejemplos de esa área."} ${goals ? `Prioriza casos que lograron ${goals}.` : ""}
          
Busca:
- Rediseños exitosos con métricas si están disponibles
- Cómo la competencia resuelve estos desafíos
- Oportunidades de diferenciación
- Convenciones de la industria (cuáles seguir, cuáles romper)

Proporciona insights accionables específicos del sector.`
          ),
          creativeDirectionsAgent.generate(
            `Propón 3-4 direcciones creativas distintas para "${topic}". ${projectType ? `Considerando que es un ${projectType}.` : ""} ${industry ? `Para el sector ${industry}.` : ""} ${goals ? `Que ayuden a lograr: ${goals}.` : ""}
          
Para cada dirección:
- Describe el concepto y la estrategia detrás
- Elementos visuales clave: colores, tipografía, estilo
- Ventajas y riesgos de cada enfoque
- Ejemplos de referencia si existen

Sé audaz y creativo. Presenta opciones que el diseñador no haya considerado. Ayúdale a ver el problema desde ángulos diferentes.`
          ),
        ])

      // Step 2: Search for inspiration images
      let availableImages: ImageData[] = []

      if (searchUnsplashImagesTool?.execute) {
        const imageSearchQuery =
          `${topic} ${projectType || "design"} ${industry || ""}`.trim()
        const imageSearchResult = await searchUnsplashImagesTool.execute(
          {
            query: imageSearchQuery,
            perPage: 12,
            orientation: projectType?.toLowerCase().includes("mobile")
              ? "portrait"
              : "landscape",
          },
          context
        )

        console.log("[trending-report] Unsplash search result:", JSON.stringify({
          success: "success" in imageSearchResult ? imageSearchResult.success : "N/A",
          hasImages: "images" in imageSearchResult,
          imageCount: "images" in imageSearchResult ? (imageSearchResult as any).images?.length : 0,
          error: "error" in imageSearchResult ? imageSearchResult.error : undefined,
        }))

        if (
          "success" in imageSearchResult &&
          imageSearchResult.success &&
          "images" in imageSearchResult
        ) {
          availableImages = imageSearchResult.images
        }
      }

      // Step 3: Generate written content using writerAgent with inspiration focus
      const writerPrompt = `
Eres un curador de inspiración creativa. Vas a sintetizar investigación de diseño en un documento inspirador.

CONTEXTO DEL PROYECTO:
${contextStr}

--- FUENTE 1: PROYECTOS INSPIRADORES ---
${projectsResult.text}

--- FUENTE 2: INSPIRACIÓN VISUAL ---
${visualResult.text}

--- FUENTE 3: EJEMPLOS DEL SECTOR ---
${industryResult.text}

--- FUENTE 4: DIRECCIONES CREATIVAS ---
${directionsResult.text}

--- IMÁGENES DE REFERENCIA DISPONIBLES ---
${availableImages
  .map(
    (img: ImageData, i: number) => `
Imagen ${i + 1}:
- ID: ${img.id}
- Descripción: ${img.description || img.altDescription || "Sin descripción"}
- Fotógrafo: ${img.photographer}
- Color dominante: ${img.color}
`
  )
  .join("\n")}

TU TAREA:
Crea entre 4 y 6 secciones que organicen esta inspiración de forma útil para un diseñador.

Cada sección debe:
- Tener un título atractivo que invite a leer
- Explicar de forma coloquial y entusiasta lo encontrado
- Conectar la inspiración con el contexto del proyecto
- Sugerir aplicaciones prácticas
- Mantener un tono conversacional, como compartir hallazgos con un colega

SELECCIÓN DE IMÁGENES:
De las ${availableImages.length} imágenes disponibles, selecciona las 5-6 más relevantes para ilustrar el reporte.

Para cada imagen seleccionada, proporciona:
- ID de la imagen
- Por qué es relevante (1-2 frases explicando cómo se relaciona con el contenido)
- Dónde colocarla en el documento (ej: "después de la sección X", "en la sección de moodboard")

IMPORTANTE:
- NO copies frases textualmente de las fuentes
- Usa la información para escribir contenido nuevo
- Enfócate en ideas prácticas y aplicables
- Ayuda al diseñador a ver posibilidades, no solo datos
- Mantén secciones sustanciales (3-4 oraciones mínimo)

Responde ÚNICAMENTE con JSON válido:

{
"subtitles": ["Título sección 1", "Título sección 2", ...],
"contents": ["Contenido redactado sección 1...", "Contenido redactado sección 2...", ...],
"selectedImages": [
  {
    "id": "id-de-la-imagen-unsplash",
    "reason": "Explicación de por qué es relevante",
    "placement": "dónde colocar en el documento"
  }
]
}
`.trim()

      const writerResult = await writerAgent.generate(writerPrompt)

      // Parse JSON response
      let subtitles: string[] = []
      let contents: string[] = []
      let selectedImages: SelectedImage[] = []

      try {
        const jsonMatch = writerResult.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          subtitles = parsed.subtitles || []
          contents = parsed.contents || []
          selectedImages = parsed.selectedImages || []
        }
      } catch (parseError) {
        console.error("Failed to parse writer response:", parseError)
      }

      console.log(`[trending-report] Available images: ${availableImages.length}`)
      console.log(`[trending-report] Writer selected images: ${selectedImages.length}`)
      if (selectedImages.length > 0) {
        console.log("[trending-report] Selected IDs:", selectedImages.map(s => s.id))
        console.log("[trending-report] Available IDs:", availableImages.map(a => a.id))
      }

      // Step 4: Prepare images for PDF
      const imagesForPdf: ImageForPdf[] = selectedImages
        .map((selected: SelectedImage) => {
          const imgData = availableImages.find(
            (img: ImageData) => img.id === selected.id
          )
          if (!imgData) {
            console.warn(`[trending-report] Image ID "${selected.id}" not found in available images`)
            return null
          }
          return {
            id: imgData.id,
            url: imgData.url,
            caption: selected.reason,
            photographer: imgData.photographer,
            photographerUrl: imgData.photographerUrl,
            color: imgData.color,
            placement: selected.placement,
          }
        })
        .filter((img: ImageForPdf | null): img is ImageForPdf => img !== null)
        .slice(0, 6) // Máximo 6 imágenes

      console.log(`[trending-report] Images for PDF: ${imagesForPdf.length}`)
      if (imagesForPdf.length > 0) {
        imagesForPdf.forEach((img, i) => {
          console.log(`[trending-report] PDF image ${i}: id=${img.id}, url=${img.url?.substring(0, 60)}, photographer=${img.photographer}`)
        })
      }

      // Step 5: Generate PDF using the tool
      if (!generatePdfTool?.execute) {
        return {
          success: false,
          topic,
          subtitles,
          contents,
          error: "PDF generation tool is not available",
        }
      }

      const safeTopic = topic.replace(/[^a-zA-Z0-9-_]/g, "-")
      const pdfResult = await generatePdfTool.execute(
        {
          filename: `inspiracion-${safeTopic}`,
          title: `Reporte de Inspiración: ${topic}`,
          subtitles,
          contents,
          images: imagesForPdf,
        },
        context
      )

      // Handle potential validation errors
      if ("error" in pdfResult && !("success" in pdfResult)) {
        return {
          success: false,
          topic,
          subtitles,
          contents,
          error: String(pdfResult.error),
        }
      }

      const pdfData = pdfResult as {
        success: boolean
        filePath?: string
        error?: string
      }

      return {
        success: true,
        topic,
        subtitles,
        contents,
        pdfPath: pdfData.success ? pdfData.filePath : undefined,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        success: false,
        topic,
        subtitles: [],
        contents: [],
        error: errorMessage,
      }
    }
  },
})
