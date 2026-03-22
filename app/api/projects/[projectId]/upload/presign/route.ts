import { NextResponse } from "next/server"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { getUserId } from "@/lib/auth"
import { getProject } from "@/src/mastra/db"
import { createS3Client, s3Config } from "@/src/mastra/workspace/s3"

type Params = { params: Promise<{ projectId: string }> }

type PresignFileInput = {
  name: string
  type?: string
  size?: number
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/[\\/]/g, "-")
  const cleaned = normalized.replace(/[\x00-\x1F\x7F]/g, "")
  const withoutLeadingDots = cleaned.replace(/^\.+/, "")
  return withoutLeadingDots.slice(0, 255)
}

function makeUniqueName(name: string, usedNames: Map<string, number>): string {
  const count = usedNames.get(name) ?? 0
  usedNames.set(name, count + 1)

  if (count === 0) return name

  const dot = name.lastIndexOf(".")
  if (dot <= 0) return `${name}-${count + 1}`

  const base = name.slice(0, dot)
  const ext = name.slice(dot)
  return `${base}-${count + 1}${ext}`
}

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

  let body: { files?: PresignFileInput[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
  }

  const files = Array.isArray(body.files) ? body.files : []
  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 })
  }

  if (files.length > 100) {
    return NextResponse.json(
      { error: "Too many files. Max 100 per request." },
      { status: 400 }
    )
  }

  const s3Client = createS3Client()
  const usedNames = new Map<string, number>()

  let uploads: Array<{
    originalName: string
    path: string
    key: string
    contentType: string
    url: string
  }>

  try {
    uploads = await Promise.all(
      files.map(async (file) => {
        const sanitized = sanitizeFileName(file.name ?? "")
        if (!sanitized) {
          throw new Error("One file has an invalid or empty name")
        }

        const uniqueName = makeUniqueName(sanitized, usedNames)
        const contentType = file.type?.trim() || "application/octet-stream"
        const key = `${project.s3Prefix}/${uniqueName}`

        const command = new PutObjectCommand({
          Bucket: s3Config.bucket,
          Key: key,
          ContentType: contentType,
        })

        const url = await getSignedUrl(s3Client, command, { expiresIn: 900 })

        return {
          originalName: file.name,
          path: uniqueName,
          key,
          contentType,
          url,
        }
      })
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to generate presigned URLs",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    projectId,
    count: uploads.length,
    expiresInSeconds: 900,
    uploads,
  })
}
