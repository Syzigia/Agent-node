import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TEMP_FILE_PREFIX = "smart-highlights-v2-";
const TEMP_DIR = path.join(os.tmpdir(), TEMP_FILE_PREFIX);

export function generateTempArtifactPath(extension: string, identifier?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const idPart = identifier ? `-${identifier}` : "";
  const filename = `${TEMP_FILE_PREFIX}${timestamp}-${random}${idPart}${extension}`;

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  return path.join(TEMP_DIR, filename);
}

export function removeArtifacts(filePaths: string[]): {
  deleted: string[];
  failed: Array<{ path: string; error: string }>;
} {
  const deleted: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const filePath of filePaths) {
    try {
      if (!fs.existsSync(filePath)) continue;

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      deleted.push(filePath);
    } catch (error) {
      failed.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { deleted, failed };
}
