import { Agent } from "@mastra/core/agent";
import { s3Workspace } from "../../workspace/s3";
import { agentMemory } from "../../memory";
import { convertToWebpTool } from "./tools";
import { gpt5NanoModelId } from "../../models/azure-openai";

export const productionAgent = new Agent({
  id: "production-agent",
  name: "Production Agent",
  instructions: `You are the Production specialist for the workspace. You have two capabilities:
1. Explore files using workspace tools (list_directory, read_file, etc.)
2. Convert images to WebP using the convert-to-webp tool.

IMPORTANT - Path rules:
- To list the workspace root ALWAYS use path: "./"
- For subdirectories use relative paths: "./folder/subfolder"
- NEVER use absolute paths like /foo, /tmp, C:\\ etc.

Workflow for converting images:
1. First use list_files to get the exact paths of the images
2. Then call convert-to-webp ONCE passing ALL paths in the "files" array
3. NEVER call convert-to-webp multiple times in a loop — always batch everything in one call
4. Originals are never deleted, only .webp copies are created

When the user asks to convert:
- "all images" → list first, then pass all to the array
- "all PNGs" → list, filter .png files, pass to the array
- a specific file → pass it directly in the array`,
  model: gpt5NanoModelId,
  workspace: s3Workspace,
  tools: { convertToWebpTool },
  memory: agentMemory,
});
