"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useChat } from "@ai-sdk/react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowLeft,
  MessageSquare,
  Plus,
  Send,
  Upload,
  Trash2,
  Bot,
  User,
  Loader2,
  Wrench,
} from "lucide-react"

type ChatRecord = {
  id: string
  title: string
  threadId: string
  createdAt: string
}

type Project = {
  id: string
  name: string
}

type StoredMessage = {
  id: string
  role: "assistant" | "user" | "system"
  parts?: Array<{
    type: string
    text?: string
    [key: string]: unknown
  }>
  content?: {
    parts?: Array<{
      type: string
      text?: string
    }>
    content?: Array<{
      type: string
      text?: string
    }>
  }
  createdAt?: string
}

type LoadedChatMessages = {
  ok: boolean
  messages: UIMessage[]
}

type ChatMessagesResponse = {
  messages?: StoredMessage[]
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function makeTitleFromMessage(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  const maxLength = 64
  if (!normalized) return "Chat"
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized
}

function uploadFileWithProgress({
  url,
  file,
  contentType,
  onProgress,
}: {
  url: string
  file: File
  contentType: string
  onProgress: (loaded: number, total: number) => void
}): Promise<{ ok: boolean; status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader(
      "Content-Type",
      contentType || file.type || "application/octet-stream"
    )

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total)
        return
      }
      onProgress(event.loaded, file.size)
    }

    xhr.onerror = () => {
      reject(new Error("Network/CORS error during direct upload"))
    }

    xhr.onabort = () => {
      reject(new Error("Upload aborted"))
    }

    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        responseText: xhr.responseText || "",
      })
    }

    xhr.send(file)
  })
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const chatIdFromUrl = searchParams.get("chatId")

  const [project, setProject] = useState<Project | null>(null)
  const [chatList, setChatList] = useState<ChatRecord[]>([])
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadedBytes, setUploadedBytes] = useState(0)
  const [totalUploadBytes, setTotalUploadBytes] = useState(0)
  const [completedUploads, setCompletedUploads] = useState(0)
  const [totalUploads, setTotalUploads] = useState(0)
  const [input, setInput] = useState("")
  const [chatsLoaded, setChatsLoaded] = useState(false)
  const [messageCache, setMessageCache] = useState<Record<string, UIMessage[]>>(
    {}
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const loadMessagesRequestRef = useRef(0)

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          agentId: "coordinatorAgent",
          projectId,
          chatId: activeChat?.id,
        },
      }),
    [projectId, activeChat?.id]
  )

  const { messages, sendMessage, status, setMessages } = useChat({
    id: activeChat?.id ?? `project-${projectId}`,
    transport: chatTransport,
  })

  useEffect(() => {
    const currentId = activeChat?.id ?? "none"
    console.log("[chat-ui] active", {
      projectId,
      activeChatId: currentId,
      chatCount: chatList.length,
    })
  }, [activeChat?.id, chatList.length, projectId])

  async function loadChatMessages(
    chat: ChatRecord
  ): Promise<LoadedChatMessages> {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chats/${chat.id}/messages`
      )
      if (!res.ok) return { ok: false, messages: [] }
      const data = (await res.json()) as ChatMessagesResponse
      const stored = Array.isArray(data.messages) ? data.messages : []

      const uiMessages: UIMessage[] = stored.map((m) => {
        const textFromRootParts =
          m.parts
            ?.filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
            .join("\n") || ""

        const textFromParts =
          m.content?.parts
            ?.filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
            .join("\n") || ""

        const textFromLegacyContent =
          m.content?.content
            ?.filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
            .join("\n") || ""

        const text = textFromRootParts || textFromParts || textFromLegacyContent

        const mappedParts =
          Array.isArray(m.parts) && m.parts.length > 0
            ? m.parts
            : text
              ? [{ type: "text", text }]
              : []

        return {
          id: m.id,
          role: m.role,
          parts: mappedParts,
        } as UIMessage
      })

      return { ok: true, messages: uiMessages }
    } catch {
      return { ok: false, messages: [] }
    }
  }

  const isLoading = status === "submitted" || status === "streaming"

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    async function load() {
      setChatsLoaded(false)
      const [projRes, chatsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/chats`),
      ])
      if (projRes.ok) setProject(await projRes.json())
      else router.push("/dashboard")

      if (chatsRes.ok) {
        const chats = (await chatsRes.json()) as ChatRecord[]
        setChatList(chats)

        if (chats.length > 0) {
          const selected =
            (chatIdFromUrl
              ? chats.find((chat) => chat.id === chatIdFromUrl)
              : null) ?? chats[0]!
          setActiveChat(selected)
        } else {
          setActiveChat(null)
          setMessages([])
        }
      }

      setChatsLoaded(true)
    }
    load()
  }, [projectId, router, chatIdFromUrl, setMessages])

  useEffect(() => {
    if (!chatsLoaded) return

    const activeChatId = activeChat?.id ?? null
    if (activeChatId === chatIdFromUrl) return

    const nextUrl = activeChatId
      ? `/dashboard/${projectId}?chatId=${activeChatId}`
      : `/dashboard/${projectId}`

    router.replace(nextUrl, { scroll: false })
  }, [activeChat?.id, chatIdFromUrl, chatsLoaded, projectId, router])

  useEffect(() => {
    const requestId = ++loadMessagesRequestRef.current

    async function hydrateActiveChat() {
      if (!activeChat) {
        setMessages([])
        return
      }

      const cached = messageCache[activeChat.id]
      if (cached) {
        setMessages(cached)
      } else {
        setMessages([])
      }

      const loaded = await loadChatMessages(activeChat)

      if (requestId !== loadMessagesRequestRef.current) return

      if (!loaded.ok) return

      setMessages(loaded.messages)
      setMessageCache((prev) => ({
        ...prev,
        [activeChat.id]: loaded.messages,
      }))
    }

    hydrateActiveChat()
  }, [activeChat?.id, projectId, setMessages])

  useEffect(() => {
    if (!activeChat) return

    setMessageCache((prev) => {
      const previous = prev[activeChat.id]

      if (
        previous &&
        previous.length === messages.length &&
        previous.every((message, idx) => message.id === messages[idx]?.id)
      ) {
        return prev
      }

      return {
        ...prev,
        [activeChat.id]: messages,
      }
    })
  }, [activeChat?.id, messages])

  async function renameChat(chatId: string, title: string) {
    const nextTitle = title.trim()
    if (!nextTitle) return

    const res = await fetch(`/api/projects/${projectId}/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle }),
    })

    if (!res.ok) return

    setChatList((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, title: nextTitle } : chat
      )
    )

    setActiveChat((prev) =>
      prev && prev.id === chatId ? { ...prev, title: nextTitle } : prev
    )
  }

  async function createChat() {
    const res = await fetch(`/api/projects/${projectId}/chats`, {
      method: "POST",
    })
    if (res.ok) {
      const chat = await res.json()
      setChatList((prev) => [chat, ...prev])
      setActiveChat(chat)
      setMessages([])
      setMessageCache((prev) => ({ ...prev, [chat.id]: [] }))
      setInput("")
    }
  }

  async function deleteChat(e: React.MouseEvent, chatId: string) {
    e.stopPropagation()
    await fetch(`/api/projects/${projectId}/chats/${chatId}`, {
      method: "DELETE",
    })
    setChatList((prev) => prev.filter((c) => c.id !== chatId))
    setMessageCache((prev) => {
      const next = { ...prev }
      delete next[chatId]
      return next
    })
    if (activeChat?.id === chatId) {
      setActiveChat(null)
      setMessages([])
      setInput("")
    }
  }

  async function selectChat(chat: ChatRecord) {
    setActiveChat(chat)
    setInput("")
  }

  function handleSend() {
    if (!input.trim() || isLoading || !activeChat) return
    const userText = input.trim()

    if (activeChat.title.startsWith("Chat ")) {
      void renameChat(activeChat.id, makeTitleFromMessage(userText))
    }

    sendMessage(
      { text: userText },
      {
        body: {
          agentId: "coordinatorAgent",
          projectId,
          chatId: activeChat.id,
        },
      }
    )
    setInput("")
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return

    const selectedFiles = Array.from(files)
    const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0)

    setUploadProgress(0)
    setUploadedBytes(0)
    setTotalUploadBytes(totalBytes)
    setCompletedUploads(0)
    setTotalUploads(selectedFiles.length)
    setUploading(true)

    try {
      const presignRes = await fetch(
        `/api/projects/${projectId}/upload/presign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: selectedFiles.map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
            })),
          }),
        }
      )

      if (!presignRes.ok) {
        let details = ""
        try {
          const data = await presignRes.json()
          details = data?.details || data?.error || ""
        } catch {
          details = await presignRes.text()
        }
        alert(
          `Failed to prepare upload (HTTP ${presignRes.status}).${
            details ? `\n${details}` : ""
          }`
        )
        return
      }

      const presignResult = await presignRes.json()
      const uploads = presignResult.uploads as Array<{
        path: string
        contentType: string
        url: string
      }>

      let uploadedCount = 0
      const errors: string[] = []
      const loadedPerFile = new Array(selectedFiles.length).fill(0)

      const updateGlobalProgress = () => {
        const totalLoaded = loadedPerFile.reduce((sum, value) => sum + value, 0)
        setUploadedBytes(totalLoaded)
        const progress =
          totalBytes > 0 ? Math.round((totalLoaded / totalBytes) * 100) : 0
        setUploadProgress(Math.min(100, progress))
      }

      await Promise.all(
        uploads.map(async (upload, index) => {
          const file = selectedFiles[index]
          if (!file) {
            errors.push(`Missing local file for ${upload.path}`)
            return
          }

          let putRes: Response
          try {
            const result = await uploadFileWithProgress({
              url: upload.url,
              file,
              contentType:
                upload.contentType || file.type || "application/octet-stream",
              onProgress: (loaded, total) => {
                const normalizedLoaded = Math.min(loaded, total || file.size)
                loadedPerFile[index] = normalizedLoaded
                updateGlobalProgress()
              },
            })

            putRes = new Response(result.responseText, {
              status: result.status,
            })
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Network/CORS error during direct upload"
            errors.push(`${file.name}: ${message}`)
            return
          }

          if (!putRes.ok) {
            let bodyPreview = ""
            try {
              bodyPreview = (await putRes.text()).slice(0, 280)
            } catch {
              bodyPreview = ""
            }
            const message = bodyPreview
              ? `${file.name}: upload failed (${putRes.status}) ${bodyPreview}`
              : `${file.name}: upload failed (${putRes.status})`
            errors.push(message)
            return
          }

          uploadedCount += 1
          setCompletedUploads((value) => value + 1)
          loadedPerFile[index] = file.size
          updateGlobalProgress()
        })
      )

      if (errors.length > 0) {
        alert(
          `Uploaded ${uploadedCount}/${selectedFiles.length} file(s). Errors:\n${errors
            .slice(0, 5)
            .join("\n")}`
        )
        return
      }

      alert(`Uploaded ${uploadedCount} file(s) successfully.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      alert(`Upload failed.\n${message}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  if (!project) {
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/dashboard")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-medium">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="size-3.5" />
            {uploading ? "Uploading..." : "Upload files"}
          </Button>
        </div>
      </div>

      {uploading && (
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Uploading {completedUploads}/{totalUploads} file(s)
            </span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatBytes(uploadedBytes)} / {formatBytes(totalUploadBytes)}
          </div>
        </div>
      )}

      <div className="flex gap-4" style={{ height: "calc(100svh - 180px)" }}>
        {/* Sidebar */}
        <div className="flex w-56 shrink-0 flex-col gap-2">
          <Button size="sm" onClick={createChat} className="w-full">
            <Plus className="size-3.5" />
            New chat
          </Button>
          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {chatList.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-muted/50 ${
                    activeChat?.id === chat.id ? "bg-muted" : ""
                  }`}
                  onClick={() => selectChat(chat)}
                >
                  <div className="flex items-center gap-2 truncate">
                    <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{chat.title}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => deleteChat(e, chat.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <Separator orientation="vertical" />

        {/* Chat area */}
        <div className="flex flex-1 flex-col">
          {!activeChat ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center text-sm text-muted-foreground">
                <MessageSquare className="mx-auto mb-2 size-8 opacity-50" />
                <p>Select a chat or create a new one</p>
              </div>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 pr-2">
                <div className="space-y-4 pb-4">
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}

                  {messages.length === 0 && status === "ready" && (
                    <div className="py-6 text-sm text-muted-foreground">
                      No messages in this chat yet.
                    </div>
                  )}

                  {status === "submitted" && (
                    <div className="flex gap-3">
                      <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Thinking...
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="mt-3 flex gap-2">
                <Textarea
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  className="min-h-10 resize-none"
                  rows={1}
                />
                <Button
                  type="button"
                  size="icon"
                  disabled={isLoading || !input.trim()}
                  onClick={handleSend}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: UIMessage }) {
  const toolParts = message.parts.filter((p) => isToolPart(p))
  const textParts = message.parts.filter((p) => p.type === "text")

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        {message.role === "user" ? (
          <User className="size-4 text-muted-foreground" />
        ) : (
          <Bot className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* Tool invocations */}
        {toolParts.map((part) => {
          const toolName =
            "toolName" in part
              ? (part.toolName as string)
              : part.type.replace(/^tool-/, "")
          const toolCallId =
            "toolCallId" in part ? (part.toolCallId as string) : part.type
          const state = "state" in part ? (part.state as string) : "unknown"
          const isDone = state === "result" || state === "output-available"

          return (
            <div
              key={toolCallId}
              className="mb-2 flex items-center gap-2 rounded-sm border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              {isDone ? (
                <Wrench className="size-3 shrink-0" />
              ) : (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              )}
              <span className="truncate">{formatToolName(toolName)}</span>
              {isDone && <span className="ml-auto text-green-500">done</span>}
            </div>
          )
        })}

        {/* Text content */}
        <div className="text-sm whitespace-pre-wrap">
          {textParts.map((p, i) =>
            p.type === "text" ? <span key={i}>{p.text}</span> : null
          )}
        </div>
      </div>
    </div>
  )
}

function isToolPart(part: UIMessage["parts"][number]): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool"
}

function formatToolName(name: string): string {
  return name.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase())
}
