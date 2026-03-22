import { mastraWeb } from "@/src/mastra/index-web"
import { getProject } from "@/src/mastra/db"
import { createRequestContext } from "@/src/mastra/workspace/context"

export async function createProjectContext(userId: string, projectId: string) {
  const project = await getProject(projectId)
  if (!project || project.userId !== userId) {
    return null
  }

  const requestContext = createRequestContext({
    s3Prefix: project.s3Prefix,
    userId,
  })

  return { project, requestContext }
}

export { mastraWeb }
