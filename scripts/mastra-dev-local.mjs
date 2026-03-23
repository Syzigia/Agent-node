import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return
  }

  const content = readFileSync(filePath, "utf8")
  const lines = content.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) {
      continue
    }

    const eqIndex = line.indexOf("=")
    if (eqIndex <= 0) {
      continue
    }

    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!originalEnvKeys.has(key)) {
      process.env[key] = value
    }
  }
}

const projectRoot = process.cwd()
const originalEnvKeys = new Set(Object.keys(process.env))
loadEnvFile(resolve(projectRoot, ".env"))
loadEnvFile(resolve(projectRoot, ".env.development"))
loadEnvFile(resolve(projectRoot, ".env.local"))
loadEnvFile(resolve(projectRoot, ".env.mastra.local"))

const forwardedArgs = process.argv.slice(2)
const mastraCliEntry = resolve(
  projectRoot,
  "node_modules",
  "mastra",
  "dist",
  "index.js"
)

const child = spawn(
  process.execPath,
  [mastraCliEntry, "dev", ...forwardedArgs],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  }
)

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
