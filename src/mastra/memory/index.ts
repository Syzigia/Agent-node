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

/**
 * Memory for the coordinator agent — working memory enabled with a focused
 * template so the model only tracks what actually matters between sessions.
 *
 * Without a custom template Mastra injects a generic "User Information" block
 * and instructs the model to "call updateWorkingMemory in EVERY response",
 * which causes dozens of unnecessary round-trips to Azure OpenAI.
 */
export const coordinatorMemory = new Memory({
  storage: sharedStore,
  options: {
    lastMessages: 20,
    workingMemory: {
      enabled: true,
      template: `# Session Context
- **Language**: [es/en]
- **Current Task**: [brief description of what the user is working on right now]
- **Active Workflow RunIds**: [runId1, runId2, ...]
- **Pending Approvals**: [workflow step waiting for user confirmation, if any]
- **User Preferences**: [any explicit preferences the user has stated, e.g. style, format]`,
    },
  },
});

/**
 * Memory for sub-agents (audio-video, production) — NO working memory.
 *
 * These agents are tool executors delegated to by the coordinator. They don't
 * need to persist user context across sessions — the coordinator already owns
 * that. Disabling working memory here eliminates redundant updateWorkingMemory
 * tool calls that were causing extra latency on every agent turn.
 */
export const agentMemory = new Memory({
  storage: sharedStore,
  options: {
    lastMessages: 20,
  },
});