import { NextRequest, NextResponse } from "next/server"

import { getUserId } from "@/lib/auth"
import { mastra } from "@/lib/mastra"
import { getChat, getProject } from "@/src/mastra/db"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<unknown> }
) {
  const userId = await getUserId()
  const { projectId, chatId } = (await context.params) as {
    projectId: string
    chatId: string
  }

  const project = await getProject(projectId)
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 })
  }

  const chat = await getChat(chatId)
  if (!chat || chat.projectId !== projectId) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 })
  }

  try {
    const storage = mastra.getStorage()
    if (!storage) {
      return NextResponse.json({ messages: [] })
    }

    const memoryStore = await storage.getStore("memory")
    if (!memoryStore) {
      return NextResponse.json({ messages: [] })
    }

    const result = await memoryStore.listMessages({
      threadId: chat.threadId,
      perPage: 200,
      page: 0,
      orderBy: { field: "createdAt", direction: "ASC" },
    })

    const normalizedMessages = result.messages.map((message) => {
      const content = message.content as
        | {
            parts?: unknown[]
            content?: unknown[]
          }
        | undefined

      return {
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        content: {
          parts: Array.isArray(content?.parts) ? content.parts : [],
          content: Array.isArray(content?.content) ? content.content : [],
        },
      }
    })

    console.log("[chat-history] loaded", {
      userId,
      projectId,
      chatId,
      threadId: chat.threadId,
      count: normalizedMessages.length,
    })

    return NextResponse.json({ messages: normalizedMessages })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}
