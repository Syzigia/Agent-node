import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const MODELS_SRC = path.join(ROOT_DIR, "src", "mastra", "public", "models");
const MODELS_DEST = path.join(ROOT_DIR, ".mastra", "output", "public", "models");

async function copyModels() {
  if (!fs.existsSync(MODELS_SRC)) {
    console.error("Models source directory not found:", MODELS_SRC);
    process.exit(1);
  }

  fs.mkdirSync(MODELS_DEST, { recursive: true });

  const files = fs.readdirSync(MODELS_SRC);
  for (const file of files) {
    const src = path.join(MODELS_SRC, file);
    const dest = path.join(MODELS_DEST, file);
    
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
      console.log(`Copied: ${file}`);
    }
  }

  console.log("✓ Models copied to build output");
}

copyModels();
