import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import { toAISdkStream } from "@mastra/ai-sdk"
import { getUserId } from "@/lib/auth"
import { createProjectContext, getMastraInstance } from "@/lib/mastra"
import { getChat } from "@/src/mastra/db"
import { NextResponse } from "next/server"

export const maxDuration = 300

const deploymentProfile = process.env.DEPLOYMENT_PROFILE ?? "full"
const webLiteOnlyAgents = new Set([
  "coordinatorAgent",
  "productionAgent",
  "photosAgent",
])

export async function POST(req: Request) {
  const userId = await getUserId()
  const body = await req.json()
  const { messages, agentId, chatId, projectId } = body

  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 })
  }

  if (deploymentProfile === "web-lite" && !webLiteOnlyAgents.has(agentId)) {
    return NextResponse.json(
      {
        error:
          "This agent is disabled in web-lite deployment. Available: coordinatorAgent, productionAgent, photosAgent.",
      },
      { status: 400 }
    )
  }

  const mastraInstance = (await getMastraInstance()) as any
  const agent = mastraInstance.getAgent(agentId)
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  }

  // Build execution options
  const options: Record<string, unknown> = {}

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required. Select a project before chatting." },
      { status: 400 }
    )
  }

  if (!chatId) {
    return NextResponse.json(
      {
        error:
          "chatId is required. Select or create a chat before sending messages.",
      },
      { status: 400 }
    )
  }

  // Resolve thread from chat
  const chat = await getChat(chatId)
  if (!chat || chat.projectId !== projectId) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 })
  }

  console.log("[chat] request", {
    userId,
    projectId,
    chatId,
    threadId: chat.threadId,
    messageCount: Array.isArray(messages) ? messages.length : 0,
  })

  options.memory = {
    thread: chat.threadId,
    resource: userId,
  }

  const ctx = await createProjectContext(userId, projectId)
  if (!ctx) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 })
  }
  options.requestContext = ctx.requestContext

  const stream = await agent.stream(messages, options)

  const sdkStream = toAISdkStream(stream, { from: "agent" })
  const reader = sdkStream.getReader()

  const uiMessageStream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writer.write(value as Parameters<typeof writer.write>[0])
      }
    },
  })

  return createUIMessageStreamResponse({
    stream: uiMessageStream,
  })
}
