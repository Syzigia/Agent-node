import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  serverExternalPackages: [
    "sharp",
    "@mastra/core",
    "@mastra/memory",
    "@mastra/libsql",
    "@mastra/s3",
    "@mastra/ai-sdk",
    "@mastra/observability",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    proxyClientMaxBodySize: "1gb",
  },
}

export default nextConfig
