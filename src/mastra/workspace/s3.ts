import { Workspace } from "@mastra/core/workspace"
import { S3Filesystem, type S3FilesystemOptions } from "@mastra/s3"
import { S3Client } from "@aws-sdk/client-s3"
import type {
  FileEntry,
  ReadOptions,
  WriteOptions,
  ListOptions,
  RemoveOptions,
  CopyOptions,
  FileContent,
} from "@mastra/core/workspace"

type ResolvedS3Config = {
  bucket: string
  region: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
}

function requireS3Config(): ResolvedS3Config {
  const bucket = process.env.S3_BUCKET
  const region = process.env.S3_REGION || "auto"
  const endpoint = process.env.S3_ENDPOINT
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

  if (!bucket) {
    throw new Error("S3_BUCKET environment variable is required")
  }
  if (!endpoint) {
    throw new Error("S3_ENDPOINT environment variable is required")
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables are required"
    )
  }

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
  }
}

export function getS3Config() {
  return requireS3Config()
}

export function createS3Client() {
  const s3Config = requireS3Config()

  return new S3Client({
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
  })
}

/**
 * S3Filesystem wrapper that normalizes "." and "./" paths to ""
 * so they resolve to the prefix root instead of a literal "." key.
 */
class PatchedS3Filesystem extends S3Filesystem {
  constructor(options: S3FilesystemOptions) {
    super(options)
  }

  private normalizePath(p: string): string {
    if (p === "." || p === "./") return ""
    if (p.startsWith("./")) return p.slice(2)
    return p
  }

  override readFile(path: string, options?: ReadOptions) {
    return super.readFile(this.normalizePath(path), options)
  }

  override writeFile(
    path: string,
    content: FileContent,
    options?: WriteOptions
  ) {
    return super.writeFile(this.normalizePath(path), content, options)
  }

  override deleteFile(path: string, options?: RemoveOptions) {
    return super.deleteFile(this.normalizePath(path), options)
  }

  override copyFile(src: string, dest: string, options?: CopyOptions) {
    return super.copyFile(
      this.normalizePath(src),
      this.normalizePath(dest),
      options
    )
  }

  override moveFile(src: string, dest: string, options?: CopyOptions) {
    return super.moveFile(
      this.normalizePath(src),
      this.normalizePath(dest),
      options
    )
  }

  override readdir(path: string, options?: ListOptions): Promise<FileEntry[]> {
    return super.readdir(this.normalizePath(path), options)
  }

  override exists(path: string) {
    return super.exists(this.normalizePath(path))
  }

  override stat(path: string) {
    return super.stat(this.normalizePath(path))
  }
}

function getDefaultPrefix() {
  return process.env.S3_PREFIX || "test"
}

let cachedDefaultS3Filesystem: PatchedS3Filesystem | null = null
let cachedDefaultS3Workspace: Workspace | null = null

export function getDefaultS3Filesystem() {
  if (cachedDefaultS3Filesystem) {
    return cachedDefaultS3Filesystem
  }

  const s3Config = requireS3Config()
  const s3Prefix = getDefaultPrefix()

  cachedDefaultS3Filesystem = new PatchedS3Filesystem({
    bucket: s3Config.bucket,
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
    prefix: s3Prefix || undefined,
  })

  return cachedDefaultS3Filesystem
}

export function getDefaultS3Workspace() {
  if (cachedDefaultS3Workspace) {
    return cachedDefaultS3Workspace
  }

  cachedDefaultS3Workspace = new Workspace({
    filesystem: getDefaultS3Filesystem(),
  })

  return cachedDefaultS3Workspace
}

/** Creates a project-scoped S3 filesystem and workspace for a given prefix */
export function createProjectWorkspace(prefix: string) {
  const s3Config = requireS3Config()

  const filesystem = new PatchedS3Filesystem({
    bucket: s3Config.bucket,
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
    prefix,
  })
  return {
    filesystem,
    workspace: new Workspace({ filesystem }),
  }
}
