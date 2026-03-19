import * as faceapi from "face-api.js";
import path from "path";

const MODELS_PATH = path.join(process.cwd(), "src", "mastra", "public", "models");

async function testModels() {
  console.log("Loading models from:", MODELS_PATH);
  
  try {
    await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
    console.log("✓ Tiny face detector loaded");
    
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
    console.log("✓ Face landmark 68 net loaded");
    
    console.log("✓ All models loaded successfully!");
  } catch (error) {
    console.error("✗ Error loading models:", error);
    process.exit(1);
  }
}

testModels();
