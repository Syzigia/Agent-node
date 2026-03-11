import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Shared LibSQLStore instance used by both Mastra storage and Memory.
 * This avoids creating duplicate connections to the same database (M7).
 *
 * mastra dev bundles code into .mastra/output/index.mjs and sets CWD to
 * src/mastra/public/, so neither relative paths nor process.cwd() resolve
 * to the project root. We use import.meta.url (preserved by the bundler)
 * to derive a stable absolute path:
 *   bundled:  <root>/.mastra/output/index.mjs  → up 2 = <root>
 *   source:   <root>/src/mastra/memory/index.ts → up 3 = <root>
 * In both cases we land at or near the project root.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Works for both bundled (.mastra/output/) and source (src/mastra/memory/) paths
const projectRoot = __dirname.includes(".mastra")
  ? path.resolve(__dirname, "..", "..")
  : path.resolve(__dirname, "..", "..", "..");
const dbPath = path.join(projectRoot, "mastra.db");

export const sharedStore = new LibSQLStore({
  id: "mastra-storage",
  url: `file:${dbPath}`,
});

export const memory = new Memory({
  storage: sharedStore,
  options: {
    lastMessages: 20,
    workingMemory: { enabled: true },
  },
});