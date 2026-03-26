import { createTool } from "@mastra/core/tools"
import { z } from "zod"

interface UnsplashImage {
  id: string
  description: string | null
  alt_description: string | null
  color: string
  urls: {
    raw: string
    full: string
    regular: string
    small: string
    thumb: string
  }
  user: {
    name: string
    links: {
      html: string
    }
  }
}

export const searchUnsplashImagesTool = createTool({
  id: "search-unsplash-images",
  description: "Search for inspiration images on Unsplash based on a query",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query for images (e.g., 'fintech app interface')"),
    perPage: z
      .number()
      .optional()
      .default(10)
      .describe("Number of images to retrieve (max 30)"),
    orientation: z
      .enum(["landscape", "portrait", "squarish"])
      .optional()
      .describe("Image orientation filter"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    images: z.array(
      z.object({
        id: z.string(),
        url: z.string(),
        description: z.string().nullable(),
        altDescription: z.string().nullable(),
        photographer: z.string(),
        photographerUrl: z.string(),
        color: z.string(),
      })
    ),
    error: z.string().optional(),
  }),
  execute: async ({ query, perPage = 10, orientation }) => {
    try {
      const apiKey = process.env.UNSPLASH_API_KEY

      if (!apiKey) {
        return {
          success: false,
          images: [],
          error:
            "Unsplash API key not configured. Please add UNSPLASH_API_KEY to your .env file.",
        }
      }

      const params = new URLSearchParams({
        query,
        per_page: Math.min(perPage, 30).toString(),
        client_id: apiKey,
      })

      if (orientation) {
        params.append("orientation", orientation)
      }

      const response = await fetch(
        `https://api.unsplash.com/search/photos?${params.toString()}`,
        {
          headers: {
            "Accept-Version": "v1",
          },
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          images: [],
          error: `Unsplash API error: ${response.status} - ${errorData.errors?.[0] || response.statusText}`,
        }
      }

      const data = await response.json()

      const images = data.results.map((img: UnsplashImage) => ({
        id: img.id,
        url: img.urls.regular, // Usamos regular (1080px de ancho)
        description: img.description,
        altDescription: img.alt_description,
        photographer: img.user?.name || "Unknown",
        photographerUrl: img.user?.links?.html || "",
        color: img.color,
      }))

      return {
        success: true,
        images,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        success: false,
        images: [],
        error: errorMessage,
      }
    }
  },
})
