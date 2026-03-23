import { LocalFilesystem, Workspace } from "@mastra/core/workspace"
import * as fs from "fs"
import * as path from "path"

const WORKSPACE_TOOL_INPUT_GUIDANCE =
  "When using workspace tools, never send null for optional fields. Omit optional keys instead."

export const WORKSPACE_PATH =
  process.env.MASTRA_STUDIO_WORKSPACE_PATH ??
  process.env.WORKSPACE_PATH ??
  path.resolve(process.cwd(), ".mastra/studio-workspace")

export const localFilesystem = new LocalFilesystem({
  basePath: WORKSPACE_PATH,
  readOnly: false,
  instructions: ({ defaultInstructions }) =>
    `${defaultInstructions}\n\n${WORKSPACE_TOOL_INPUT_GUIDANCE}`,
})

export const workspace = new Workspace({
  filesystem: localFilesystem,
})

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

function walkWorkspaceFiles(
  currentDir: string,
  rootDir: string,
  results: string[]
): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name)

    if (entry.isDirectory()) {
      walkWorkspaceFiles(absolutePath, rootDir, results)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const relativePath = path
      .relative(rootDir, absolutePath)
      .replace(/\\/g, "/")
    results.push(relativePath)
  }
}

export function listWorkspaceMediaFiles(): string[] {
  const files: string[] = []
  walkWorkspaceFiles(WORKSPACE_PATH, WORKSPACE_PATH, files)

  return files.filter((file) =>
    MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())
  )
}

export function resolveWorkspaceMediaPath(filePath: string): {
  resolvedPath: string
  candidates: string[]
} {
  const sanitized = sanitizePath(filePath)
  const directPath = path.join(WORKSPACE_PATH, sanitized)

  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return {
      resolvedPath: sanitized.replace(/\\/g, "/"),
      candidates: [sanitized.replace(/\\/g, "/")],
    }
  }

  const mediaFiles = listWorkspaceMediaFiles()
  const normalizedInput = sanitized.replace(/\\/g, "/").toLowerCase()
  const inputBase = path
    .basename(sanitized, path.extname(sanitized))
    .toLowerCase()
  const inputFileName = path.basename(sanitized).toLowerCase()

  const exactFileNameMatches = mediaFiles.filter(
    (file) => path.basename(file).toLowerCase() === inputFileName
  )

  if (exactFileNameMatches.length === 1) {
    return {
      resolvedPath: exactFileNameMatches[0]!,
      candidates: exactFileNameMatches,
    }
  }

  const basenameMatches = mediaFiles.filter(
    (file) =>
      path.basename(file, path.extname(file)).toLowerCase() === inputBase
  )

  if (basenameMatches.length === 1) {
    return { resolvedPath: basenameMatches[0]!, candidates: basenameMatches }
  }

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

  throw new Error(
    `Media file not found in workspace: "${filePath}". Available similar files: ${
      mediaFiles
        .filter((file) => path.basename(file).toLowerCase().includes(inputBase))
        .slice(0, 5)
        .join(", ") || "none"
    }`
  )
}

/**
 * Sanitizes a file path from LLM input to prevent:
 * - Absolute paths (/foo/bar, C:\foo\bar)
 * - Directory traversal (../../etc/passwd)
 * - Leading slashes that break path.join behavior
 * - Windows drive-letter relative paths (C:..\..\foo)
 * - Null byte injection (\0 causes OS-level path truncation)
 *
 * Always returns a clean relative path within the workspace.
 */
export function sanitizePath(filePath: string): string {
  // Strip null bytes — they cause OS-level path truncation
  let sanitized = filePath.replace(/\0/g, "")

  // Strip Windows drive-letter prefixes (e.g., "C:", "D:")
  // On Windows, "C:foo" is relative to the CWD of the C: drive, bypassing isAbsolute()
  sanitized = sanitized.replace(/^[a-zA-Z]:/, "")

  // Strip leading slashes and backslashes (absolute path attempts)
  sanitized = sanitized.replace(/^[\/\\]+/, "")

  // Normalize separators to OS-native
  sanitized = path.normalize(sanitized)

  // After normalization, check for remaining absolute paths or traversals
  if (path.isAbsolute(sanitized)) {
    throw new Error(
      `Invalid path: "${filePath}". Use relative paths within the workspace (e.g., "video.mp4", "folder/file.mp3").`
    )
  }

  // Block directory traversal attempts
  if (sanitized.startsWith("..") || sanitized.includes(`..${path.sep}`)) {
    throw new Error(
      `Invalid path: "${filePath}". Accessing files outside the workspace is not allowed.`
    )
  }

  return sanitized
}
