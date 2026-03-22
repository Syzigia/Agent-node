import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"
import type { Mastra } from "@mastra/core"
import { RequestContext } from "@mastra/core/request-context"
import { createProjectWorkspace, s3Filesystem, s3Workspace } from "./s3"

export interface ProjectContext {
  s3Prefix: string
  userId: string
}

/**
 * Creates a RequestContext with the project's S3 prefix resolved from DB.
 * Pass this to agent.stream() / agent.generate() so tools get the right workspace.
 */
export function createRequestContext(
  projectContext: ProjectContext
): RequestContext<ProjectContext> {
  const requestContext = new RequestContext<ProjectContext>()
  requestContext.set("s3Prefix", projectContext.s3Prefix)
  requestContext.set("userId", projectContext.userId)
  return requestContext
}

/**
 * Returns the project-scoped S3 filesystem from tool context.
 * Falls back to the global s3Filesystem (for local dev / Mastra Studio).
 */
export function getFilesystem(context?: {
  requestContext?: { get: (key: string) => any }
}) {
  const s3Prefix = context?.requestContext?.get("s3Prefix") as
    | string
    | undefined
  if (s3Prefix) {
    return createProjectWorkspace(s3Prefix).filesystem
  }
  return s3Filesystem
}

/**
 * Returns the project-scoped workspace from request context.
 * Falls back to the default s3Workspace (for local dev / Mastra Studio).
 */
export function getWorkspace(context?: {
  requestContext?: { get: (key: string) => any }
}) {
  const s3Prefix = context?.requestContext?.get("s3Prefix") as
    | string
    | undefined
  if (s3Prefix) {
    return createProjectWorkspace(s3Prefix).workspace
  }
  return s3Workspace
}

/**
 * Gets project context from request context or returns null
 */
export function getProjectContext(context?: {
  requestContext?: { get: (key: string) => any }
}): ProjectContext | null {
  const s3Prefix = context?.requestContext?.get("s3Prefix") as
    | string
    | undefined
  const userId = context?.requestContext?.get("userId") as string | undefined
  if (s3Prefix && userId) {
    return { s3Prefix, userId }
  }
  return null
}

// ─── Temporary file management for S3 workflows ───────────────────────────────

const TEMP_DIR_PREFIX = "mastra-s3-"

/**
 * Creates a temporary directory for processing files from S3
 */
export function createTempWorkspace(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX))
  return tempDir
}

/**
 * Generates a deterministic local path for an S3 file based on its hash
 * This ensures the same S3 file always maps to the same temp location
 */
export function getTempPathForS3File(s3Path: string, tempDir: string): string {
  const hash = createHash("sha256").update(s3Path).digest("hex").slice(0, 16)
  const ext = path.extname(s3Path)
  const baseName = path.basename(s3Path, ext)
  return path.join(tempDir, `${baseName}_${hash}${ext}`)
}

export interface DownloadedFile {
  localPath: string
  s3Path: string
  size: number
}

/**
 * Downloads a file from S3 to a local temporary path
 */
export async function downloadFromS3(
  filesystem: ReturnType<typeof getFilesystem>,
  s3Path: string,
  localPath: string
): Promise<DownloadedFile> {
  // Ensure directory exists
  const dir = path.dirname(localPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Read from S3
  const content = await filesystem.readFile(s3Path)

  // Write to local temp file
  fs.writeFileSync(localPath, content)

  const stats = fs.statSync(localPath)

  return {
    localPath,
    s3Path,
    size: stats.size,
  }
}

/**
 * Uploads a local file to S3
 */
export async function uploadToS3(
  filesystem: ReturnType<typeof getFilesystem>,
  localPath: string,
  s3Path: string
): Promise<void> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`)
  }

  const content = fs.readFileSync(localPath)
  await filesystem.writeFile(s3Path, content)
}

/**
 * Ensures a file from S3 is available locally (downloads if needed)
 * Uses the temp workspace for storage
 */
export async function ensureLocalFile(
  filesystem: ReturnType<typeof getFilesystem>,
  s3Path: string,
  tempDir: string
): Promise<DownloadedFile> {
  const localPath = getTempPathForS3File(s3Path, tempDir)

  // Check if already downloaded
  if (fs.existsSync(localPath)) {
    const stats = fs.statSync(localPath)
    return {
      localPath,
      s3Path,
      size: stats.size,
    }
  }

  return downloadFromS3(filesystem, s3Path, localPath)
}

/**
 * Cleans up temporary workspace
 */
export function cleanupTempWorkspace(tempDir: string): void {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Lists media files in S3 workspace
 */
const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".webm",
  ".flv",
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
  ".ogg",
])

export async function listS3MediaFiles(
  filesystem: ReturnType<typeof getFilesystem>,
  prefix: string = ""
): Promise<string[]> {
  const entries = await filesystem.readdir(prefix)
  const files: string[] = []

  for (const entry of entries) {
    if (entry.type === "file") {
      const ext = path.extname(entry.name).toLowerCase()
      if (MEDIA_EXTENSIONS.has(ext)) {
        files.push(prefix ? `${prefix}/${entry.name}` : entry.name)
      }
    } else if (entry.type === "directory") {
      const subFiles = await listS3MediaFiles(
        filesystem,
        prefix ? `${prefix}/${entry.name}` : entry.name
      )
      files.push(...subFiles)
    }
  }

  return files
}

/**
 * Resolves a media file path in S3 with fuzzy matching
 */
export async function resolveS3MediaPath(
  filesystem: ReturnType<typeof getFilesystem>,
  filePath: string
): Promise<{ resolvedPath: string; candidates: string[] }> {
  const exists = await filesystem.exists(filePath)

  if (exists) {
    return { resolvedPath: filePath, candidates: [filePath] }
  }

  // Try to find with fuzzy matching
  const mediaFiles = await listS3MediaFiles(filesystem)
  const normalizedInput = filePath.toLowerCase()
  const inputBase = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
  const inputFileName = path.basename(filePath).toLowerCase()

  // Exact filename match
  const exactFileNameMatches = mediaFiles.filter(
    (file) => path.basename(file).toLowerCase() === inputFileName
  )

  if (exactFileNameMatches.length === 1) {
    return {
      resolvedPath: exactFileNameMatches[0]!,
      candidates: exactFileNameMatches,
    }
  }

  // Basename match
  const basenameMatches = mediaFiles.filter(
    (file) =>
      path.basename(file, path.extname(file)).toLowerCase() === inputBase
  )

  if (basenameMatches.length === 1) {
    return { resolvedPath: basenameMatches[0]!, candidates: basenameMatches }
  }

  // Prefix match
  const prefixMatches = mediaFiles.filter((file) =>
    file.toLowerCase().startsWith(normalizedInput)
  )

  if (prefixMatches.length === 1) {
    return { resolvedPath: prefixMatches[0]!, candidates: prefixMatches }
  }

  const candidates = exactFileNameMatches.length
    ? exactFileNameMatches
    : basenameMatches.length
      ? basenameMatches
      : prefixMatches

  if (candidates.length > 1) {
    throw new Error(
      `Media file path is ambiguous: "${filePath}". Possible matches: ${candidates.join(", ")}`
    )
  }

  throw new Error(`Media file not found in workspace: "${filePath}".`)
}
