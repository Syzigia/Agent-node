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

const s3Bucket = process.env.S3_BUCKET
const s3Region = process.env.S3_REGION || "auto"
const s3Endpoint = process.env.S3_ENDPOINT
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY
const s3Prefix = process.env.S3_PREFIX || "test"

if (!s3Bucket) {
  throw new Error("S3_BUCKET environment variable is required")
}
if (!s3Endpoint) {
  throw new Error("S3_ENDPOINT environment variable is required")
}
if (!s3AccessKeyId || !s3SecretAccessKey) {
  throw new Error(
    "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables are required"
  )
}

export const s3Config = {
  bucket: s3Bucket,
  region: s3Region,
  endpoint: s3Endpoint,
  accessKeyId: s3AccessKeyId,
  secretAccessKey: s3SecretAccessKey,
} as const

export function createS3Client() {
  return new S3Client({
    region: s3Region,
    endpoint: s3Endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3AccessKeyId!,
      secretAccessKey: s3SecretAccessKey!,
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

/** Default filesystem using S3_PREFIX env var (for local dev / Mastra Studio) */
export const s3Filesystem = new PatchedS3Filesystem({
  bucket: s3Bucket,
  region: s3Region,
  endpoint: s3Endpoint,
  accessKeyId: s3AccessKeyId,
  secretAccessKey: s3SecretAccessKey,
  prefix: s3Prefix || undefined,
})

/** Default workspace using S3_PREFIX env var (for local dev / Mastra Studio) */
export const s3Workspace = new Workspace({
  filesystem: s3Filesystem,
})

/** Creates a project-scoped S3 filesystem and workspace for a given prefix */
export function createProjectWorkspace(prefix: string) {
  const filesystem = new PatchedS3Filesystem({
    bucket: s3Bucket!,
    region: s3Region,
    endpoint: s3Endpoint!,
    accessKeyId: s3AccessKeyId!,
    secretAccessKey: s3SecretAccessKey!,
    prefix,
  })
  return {
    filesystem,
    workspace: new Workspace({ filesystem }),
  }
}
