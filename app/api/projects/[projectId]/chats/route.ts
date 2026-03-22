import { NextResponse } from "next/server"
import { getUserId } from "@/lib/auth"
import { getProject, createChat, getChatsByProject } from "@/src/mastra/db"

type Params = { params: Promise<{ projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const userId = await getUserId()
  const { projectId } = await params
  const project = await getProject(projectId)

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 })
  }

  const rows = await getChatsByProject(projectId)
  return NextResponse.json(rows)
}

export async function POST(req: Request, { params }: Params) {
  const userId = await getUserId()
  const { projectId } = await params
  const project = await getProject(projectId)

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const providedTitle = (body as { title?: string }).title?.trim()
  const fallbackTitle = `Chat ${new Date().toISOString().slice(0, 16).replace("T", " ")}`

  const chat = await createChat({
    id: crypto.randomUUID(),
    projectId,
    title: providedTitle || fallbackTitle,
    threadId: crypto.randomUUID(),
  })
  return NextResponse.json(chat, { status: 201 })
}
