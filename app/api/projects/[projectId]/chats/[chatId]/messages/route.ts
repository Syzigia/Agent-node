import { NextRequest, NextResponse } from "next/server"
import { LibSQLStore } from "@mastra/libsql"

import { getUserId } from "@/lib/auth"
import { getChat, getProject } from "@/src/mastra/db"

const databaseUrl = process.env.DATABASE_URL
const databaseToken = process.env.DATABASE_TOKEN

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required")
}

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
    const store = new LibSQLStore({
      id: "chat-history-store",
      url: databaseUrl!,
      authToken: databaseToken,
    })

    const memoryStore = await store.getStore("memory")
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

    return NextResponse.json({ messages: normalizedMessages })
  } catch {
    return NextResponse.json({ messages: [] })
  }
}
