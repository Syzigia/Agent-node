import { createStep, createWorkflow } from "@mastra/core/workflows"
import z from "zod"
import {
  projectExamplesAgent,
  visualInspirationAgent,
  industryShowcaseAgent,
  creativeDirectionsAgent,
} from "./agent"

const projectsStep = createStep({
  id: "projects-research",
  inputSchema: z.object({
    topic: z.string(),
    projectType: z.string().optional(),
    industry: z.string().optional(),
  }),
  outputSchema: z.object({
    projects: z.string(),
  }),
  execute: async ({ inputData }) => {
    const result = await projectExamplesAgent.generate(
      `Busca proyectos de diseño inspiradores sobre "${inputData.topic}". ${inputData.projectType ? `Enfócate en ${inputData.projectType}.` : ""} ${inputData.industry ? `Prioriza ejemplos del sector ${inputData.industry}.` : ""}
      
Busca proyectos reales con resultados, case studies en Behance, Dribbble, Awwwards.
Describe qué hace especial a cada proyecto y da ideas prácticas aplicables.`
    )
    return { projects: result.text }
  },
})

const visualStep = createStep({
  id: "visual-research",
  inputSchema: z.object({
    topic: z.string(),
    projectType: z.string().optional(),
  }),
  outputSchema: z.object({
    visual: z.string(),
  }),
  execute: async ({ inputData }) => {
    const result = await visualInspirationAgent.generate(
      `Descubre tendencias visuales actuales para "${inputData.topic}". ${inputData.projectType ? `Aplica a ${inputData.projectType}.` : ""}
      
Busca paletas de colores, tipografías, estilos visuales y layouts innovadores.
Describe los elementos de forma evocadora y sugerente.`
    )
    return { visual: result.text }
  },
})

const industryStep = createStep({
  id: "industry-research",
  inputSchema: z.object({
    topic: z.string(),
    industry: z.string().optional(),
  }),
  outputSchema: z.object({
    industry: z.string(),
  }),
  execute: async ({ inputData }) => {
    const result = await industryShowcaseAgent.generate(
      `Investiga ejemplos del sector sobre "${inputData.topic}". ${inputData.industry ? `Enfócate en ${inputData.industry}.` : ""}
      
Busca rediseños exitosos, benchmarking competitivo y oportunidades de diferenciación.`
    )
    return { industry: result.text }
  },
})

const directionsStep = createStep({
  id: "directions-research",
  inputSchema: z.object({
    topic: z.string(),
    projectType: z.string().optional(),
    industry: z.string().optional(),
  }),
  outputSchema: z.object({
    directions: z.string(),
  }),
  execute: async ({ inputData }) => {
    const result = await creativeDirectionsAgent.generate(
      `Propón 3-4 direcciones creativas distintas para "${inputData.topic}". ${inputData.projectType ? `Considerando ${inputData.projectType}.` : ""} ${inputData.industry ? `Para ${inputData.industry}.` : ""}
      
Cada dirección debe incluir concepto, elementos visuales clave, ventajas/riesgos.`
    )
    return { directions: result.text }
  },
})

const combineStep = createStep({
  id: "combine-results",
  inputSchema: z.object({
    "projects-research": z.object({
      projects: z.string(),
    }),
    "visual-research": z.object({
      visual: z.string(),
    }),
    "industry-research": z.object({
      industry: z.string(),
    }),
    "directions-research": z.object({
      directions: z.string(),
    }),
  }),
  outputSchema: z.object({
    projects: z.string().describe("Inspiring design projects and case studies"),
    visual: z.string().describe("Visual inspiration and trends"),
    industry: z.string().describe("Industry-specific examples"),
    directions: z.string().describe("Creative directions to explore"),
  }),
  execute: async ({ inputData }) => {
    return {
      projects: inputData["projects-research"].projects,
      visual: inputData["visual-research"].visual,
      industry: inputData["industry-research"].industry,
      directions: inputData["directions-research"].directions,
    }
  },
})

export const searchTrending = createWorkflow({
  id: "search-trending",
  inputSchema: z.object({
    topic: z.string().describe("The topic to search for inspiration"),
    projectType: z.string().optional().describe("Type of design project"),
    industry: z.string().optional().describe("Client industry"),
  }),
  outputSchema: z.object({
    projects: z.string().describe("Inspiring design projects and case studies"),
    visual: z.string().describe("Visual inspiration and trends"),
    industry: z.string().describe("Industry-specific examples"),
    directions: z.string().describe("Creative directions to explore"),
  }),
})
  .parallel([projectsStep, visualStep, industryStep, directionsStep])
  .then(combineStep)
  .commit()
