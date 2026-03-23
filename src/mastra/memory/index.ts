import { Memory } from "@mastra/memory"
import { LibSQLStore } from "@mastra/libsql"

const databaseUrl = process.env.DATABASE_URL
const databaseToken = process.env.DATABASE_TOKEN

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required")
}

export const sharedStore = new LibSQLStore({
  id: "mastra-storage",
  url: databaseUrl,
  authToken: databaseToken,
})

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
})

/**
 * Memory for sub-agents (production, photos) — NO working memory.
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
})
