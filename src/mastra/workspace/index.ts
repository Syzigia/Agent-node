import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import * as path from "path";

export const WORKSPACE_PATH =
  process.env.WORKSPACE_PATH ?? "c:\\Users\\jorge\\Code\\workflowtest";

export const workspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: WORKSPACE_PATH,
    readOnly: false,
  }),
});

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
  let sanitized = filePath.replace(/\0/g, "");

  // Strip Windows drive-letter prefixes (e.g., "C:", "D:")
  // On Windows, "C:foo" is relative to the CWD of the C: drive, bypassing isAbsolute()
  sanitized = sanitized.replace(/^[a-zA-Z]:/, "");

  // Strip leading slashes and backslashes (absolute path attempts)
  sanitized = sanitized.replace(/^[\/\\]+/, "");

  // Normalize separators to OS-native
  sanitized = path.normalize(sanitized);

  // After normalization, check for remaining absolute paths or traversals
  if (path.isAbsolute(sanitized)) {
    throw new Error(
      `Invalid path: "${filePath}". Use relative paths within the workspace (e.g., "video.mp4", "folder/file.mp3").`
    );
  }

  // Block directory traversal attempts
  if (sanitized.startsWith("..") || sanitized.includes(`..${path.sep}`)) {
    throw new Error(
      `Invalid path: "${filePath}". Accessing files outside the workspace is not allowed.`
    );
  }

  return sanitized;
}