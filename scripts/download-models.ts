import fs from "fs";
import path from "path";
import https from "https";

const MODELS_DIR = path.join(process.cwd(), "src", "mastra", "public", "models");

const MODELS_BASE_URL = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";

const MODELS = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  "face_landmark_68_model-weights_manifest.json", 
  "face_landmark_68_model-shard1",
];

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location!, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        }).on("error", reject);
      } else {
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function downloadModels() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    console.log(`Created directory: ${MODELS_DIR}`);
  }

  console.log("Downloading face-api.js models...");
  
  for (const model of MODELS) {
    const url = `${MODELS_BASE_URL}/${model}`;
    const dest = path.join(MODELS_DIR, model);
    
    if (fs.existsSync(dest)) {
      console.log(`✓ ${model} already exists`);
      continue;
    }
    
    try {
      console.log(`Downloading ${model}...`);
      await downloadFile(url, dest);
      console.log(`✓ Downloaded ${model}`);
    } catch (error) {
      console.error(`✗ Failed to download ${model}:`, error);
      process.exit(1);
    }
  }
  
  console.log("\n✓ All models downloaded successfully!");
}

downloadModels();
