import { getProject } from "@/src/mastra/db"
import { createRequestContext } from "@/src/mastra/workspace/context"

/**
 * Creates a RequestContext with the project's S3 prefix resolved from DB.
 * Pass this to agent.stream() / agent.generate() so tools get the right workspace.
 */
export async function createProjectContext(userId: string, projectId: string) {
  const project = await getProject(projectId)
  if (!project || project.userId !== userId) {
    return null
  }

  const requestContext = createRequestContext({
    s3Prefix: project.s3Prefix,
    userId: userId,
  })

  return { project, requestContext }
}

let cachedMastra: any = null

export async function getMastraInstance() {
  if (cachedMastra) {
    return cachedMastra
  }

  const deploymentProfile = process.env.DEPLOYMENT_PROFILE ?? "full"

  if (deploymentProfile === "web-lite") {
    const mod = await import("@/src/mastra/index-web")
    cachedMastra = mod.mastraWeb
    return cachedMastra
  }

  const mod = await import("@/src/mastra")
  cachedMastra = mod.mastra
  return cachedMastra
}
