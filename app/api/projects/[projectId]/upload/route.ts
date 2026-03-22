import { NextResponse } from "next/server"
import { getUserId } from "@/lib/auth"
import { getProject } from "@/src/mastra/db"
import { createProjectWorkspace } from "@/src/mastra/workspace/s3"

type Params = { params: Promise<{ projectId: string }> }

export async function POST(req: Request, { params }: Params) {
  let userId: string
  try {
    userId = await getUserId()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { projectId } = await params

  const project = await getProject(projectId)
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let files: File[]
  try {
    const formData = await req.formData()
    files = formData.getAll("files") as File[]
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid multipart upload payload. If the file is large, retry after restarting dev server with updated proxy matcher.",
      },
      { status: 400 }
    )
  }

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 })
  }

  const { filesystem } = createProjectWorkspace(project.s3Prefix)

  let count = 0
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer())
    await filesystem.writeFile(file.name, buffer)
    count++
  }

  return NextResponse.json({ count, projectId })
}
