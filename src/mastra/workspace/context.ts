import { s3Filesystem } from "./s3";
import { createProjectWorkspace } from "./s3";

/**
 * Returns the project-scoped S3 filesystem from tool context.
 * Falls back to the global s3Filesystem (for local dev / Mastra Studio).
 */
export function getFilesystem(context?: { requestContext?: { get: (key: string) => any } }) {
  const s3Prefix = context?.requestContext?.get("s3Prefix") as string | undefined;
  if (s3Prefix) {
    return createProjectWorkspace(s3Prefix).filesystem;
  }
  return s3Filesystem;
}
