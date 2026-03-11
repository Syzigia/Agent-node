import { removeFiles } from "../utils";

/**
 * Cleanup - Remove temporary files
 *
 * 1. Takes a list of temporary file paths
 * 2. Attempts to delete each file
 * 3. Logs any failures but continues with remaining files
 * 4. Returns success status and lists of deleted/failed files
 */
export function cleanupFiles(tempFiles: string[]): {
  success: boolean;
  deletedFiles: string[];
  failedFiles: Array<{ path: string; error: string }>;
} {
  console.log(`[cleanupFiles] Starting cleanup of ${tempFiles.length} temporary files`);

  if (tempFiles.length === 0) {
    console.log(`[cleanupFiles] No files to clean up`);
    return {
      success: true,
      deletedFiles: [],
      failedFiles: [],
    };
  }

  const result = removeFiles(tempFiles);

  console.log(`[cleanupFiles] Cleanup complete: ${result.deleted.length} deleted, ${result.failed.length} failed`);

  for (const failure of result.failed) {
    console.warn(`[cleanupFiles] Failed to delete: ${failure.path} - ${failure.error}`);
  }

  return {
    success: result.failed.length === 0,
    deletedFiles: result.deleted,
    failedFiles: result.failed,
  };
}
