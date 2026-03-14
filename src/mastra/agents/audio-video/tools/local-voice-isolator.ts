import * as ort from "onnxruntime-node";
import * as fsNative from "fs";
import * as path from "path";
import * as os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import axios from "axios";

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Model configuration
const MODEL_URL = "https://huggingface.co/MrCitron/demucs-v4-onnx/resolve/main/htdemucs.onnx";
const MODEL_FILENAME = "htdemucs.onnx";
const SAMPLE_RATE = 44100;
const MAX_SEGMENT_LENGTH = 7.8; // seconds (HTDemucs limit)

/**
 * Local Voice Isolation using Demucs ONNX Model
 * Completely offline processing - no cloud services required
 */
export class LocalVoiceIsolator {
  private session: ort.InferenceSession | null = null;
  private modelPath: string;

  constructor() {
    // Store model in a .models directory within the OS temp directory
    this.modelPath = path.join(os.tmpdir(), ".mastra-models", MODEL_FILENAME);
  }

  /**
   * Download the Demucs ONNX model if not exists
   */
  async downloadModel(): Promise<void> {
    if (fsNative.existsSync(this.modelPath)) {
      console.log("[LocalVoiceIsolator] ONNX model already downloaded");
      return;
    }

    fsNative.mkdirSync(path.dirname(this.modelPath), { recursive: true });
    console.log("[LocalVoiceIsolator] Downloading Demucs ONNX model (303 MB)...");
    console.log("[LocalVoiceIsolator] This may take several minutes...");

    try {
      const response = await axios.get(MODEL_URL, {
        responseType: "stream",
        onDownloadProgress: (progressEvent) => {
          const loaded = progressEvent.loaded || 0;
          const total = progressEvent.total || 0;
          if (total > 0) {
            const percent = Math.round((loaded / total) * 100);
            process.stdout.write(`\r[LocalVoiceIsolator] Progress: ${percent}%`);
          }
        },
      });

      const writer = fsNative.createWriteStream(this.modelPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.log("\n[LocalVoiceIsolator] Model downloaded successfully");
    } catch (error: any) {
      console.error("[LocalVoiceIsolator] Error downloading model:", error.message);
      throw error;
    }
  }

  /**
   * Load ONNX model and create inference session
   */
  async loadModel(): Promise<void> {
    if (this.session) {
      return; // Already loaded
    }

    await this.downloadModel();

    console.log("[LocalVoiceIsolator] Loading ONNX model...");
    try {
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["cpu"], // CPU only for compatibility
        graphOptimizationLevel: "all",
      });
      console.log("[LocalVoiceIsolator] Model loaded successfully");
    } catch (error: any) {
      console.error("[LocalVoiceIsolator] Error loading model:", error.message);
      throw error;
    }
  }

  /**
   * Extract audio to raw float32 data using ffmpeg
   * Returns interleaved stereo audio as Float32Array
   */
  async extractAudioToFloat32(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log("[LocalVoiceIsolator] Extracting audio to raw format...");
      
      ffmpeg(inputPath)
        .outputOptions([
          '-ar', String(SAMPLE_RATE),     // Sample rate 44.1kHz
          '-ac', '2',                      // Stereo
          '-f', 'f32le',                  // 32-bit float little-endian raw
          '-c:a', 'pcm_f32le'             // PCM 32-bit float
        ])
        .on("end", () => {
          console.log("[LocalVoiceIsolator] Extraction completed");
          resolve();
        })
        .on("error", (err) => {
          console.error("[LocalVoiceIsolator] Extraction error:", err.message);
          reject(err);
        })
        .save(outputPath);
    });
  }

  /**
   * Process audio in segments and extract vocals
   */
  async processAudio(inputPath: string): Promise<Buffer> {
    if (!this.session) {
      await this.loadModel();
    }

    // Create temp directory for processing
    const tempDir = path.join(os.tmpdir(), `.mastra-isolation_${Date.now()}`);
    fsNative.mkdirSync(tempDir, { recursive: true });

    try {
      // Extract audio to raw float32 format
      const tempRawPath = path.join(tempDir, "audio.raw");
      await this.extractAudioToFloat32(inputPath, tempRawPath);

      // Load raw audio data
      console.log("[LocalVoiceIsolator] Loading audio data...");
      const rawBuffer = fsNative.readFileSync(tempRawPath);
      
      // Convert Buffer to Float32Array
      // Each sample is 4 bytes (32-bit float)
      const totalFloats = rawBuffer.length / 4;
      const audioData = new Float32Array(totalFloats);
      
      for (let i = 0; i < totalFloats; i++) {
        audioData[i] = rawBuffer.readFloatLE(i * 4);
      }

      // Data is interleaved stereo: [L, R, L, R, ...]
      const totalSamples = totalFloats / 2;

      console.log(`[LocalVoiceIsolator] Audio loaded: ${totalSamples} samples @ ${SAMPLE_RATE}Hz`);

      // Calculate segments - use fixed size for all segments
      const FIXED_SEGMENT_SAMPLES = 343980; // Fixed size required by the model
      const numSegments = Math.ceil(totalSamples / FIXED_SEGMENT_SAMPLES);

      console.log(`[LocalVoiceIsolator] Processing ${numSegments} segments of ${FIXED_SEGMENT_SAMPLES} samples each...`);

      // Process each segment
      const vocalsSegments: Float32Array[] = [];
      const segmentActualLengths: number[] = []; // Track actual (non-padded) lengths

      for (let i = 0; i < numSegments; i++) {
        const startSample = i * FIXED_SEGMENT_SAMPLES;
        const actualEndSample = Math.min((i + 1) * FIXED_SEGMENT_SAMPLES, totalSamples);
        const actualSegmentLength = actualEndSample - startSample;
        
        // Store actual length for later trimming
        segmentActualLengths.push(actualSegmentLength);
        
        console.log(`[LocalVoiceIsolator] Processing segment ${i + 1}/${numSegments} (${actualSegmentLength} samples, padded to ${FIXED_SEGMENT_SAMPLES})...`);

        // Extract segment from interleaved data
        // Use fixed size with zero-padding for incomplete segments
        const segmentData = new Float32Array(2 * FIXED_SEGMENT_SAMPLES);
        const startIdx = startSample * 2;
        const samplesToCopy = actualSegmentLength * 2;
        
        for (let j = 0; j < samplesToCopy; j++) {
          const value = audioData[startIdx + j];
          if (value !== undefined) {
            segmentData[j] = value;
          }
        }
        // Rest of array is already initialized with zeros (padding)

        // Create tensor [1, 2, samples] - batch, channels, time
        // Need to deinterleave: separate left and right channels
        const leftChannel = new Float32Array(FIXED_SEGMENT_SAMPLES);
        const rightChannel = new Float32Array(FIXED_SEGMENT_SAMPLES);
        
        for (let j = 0; j < FIXED_SEGMENT_SAMPLES; j++) {
          const leftVal = segmentData[j * 2];
          const rightVal = segmentData[j * 2 + 1];
          if (leftVal !== undefined && rightVal !== undefined) {
            leftChannel[j] = leftVal;
            rightChannel[j] = rightVal;
          }
        }
        
        // Create tensor with shape [1, 2, samples] - always use FIXED_SEGMENT_SAMPLES
        const tensorData = new Float32Array(2 * FIXED_SEGMENT_SAMPLES);
        tensorData.set(leftChannel, 0);
        tensorData.set(rightChannel, FIXED_SEGMENT_SAMPLES);
        
        const inputTensor = new ort.Tensor("float32", tensorData, [1, 2, FIXED_SEGMENT_SAMPLES]);

        // Run inference
        const feeds: Record<string, ort.Tensor> = { input: inputTensor };
        const results = await this.session!.run(feeds);

        // Get the output - Demucs returns all stems in a single output tensor
        // Shape: [batch, stems, channels, samples] where stems=4 (drums, bass, vocals, other)
        const outputNames = this.session!.outputNames;
        const outputKey = outputNames[0]; // Use first available output
        
        if (!outputKey) {
          throw new Error(`No output found. Available outputs: ${outputNames.join(", ")}`);
        }
        
        const output = results[outputKey];

        if (!output) {
          throw new Error(`No output found with key: ${outputKey}`);
        }

        // The output tensor has shape [1, 4, 2, samples] - [batch, stems, channels, time]
        // stems: 0=drums, 1=bass, 2=vocals, 3=other
        // We need vocals (index 2)
        const outputData = output.data as Float32Array;
        const outputDims = output.dims; // Should be [1, 4, 2, samples]
        
        console.log(`[LocalVoiceIsolator] Output shape: [${outputDims.join(", ")}]`);
        
        if (!outputDims || outputDims.length < 4) {
          throw new Error(`Unexpected output format. Dims: ${outputDims?.join(", ") ?? "undefined"}`);
        }
        
        const numStems = outputDims[1] ?? 4; // 4
        const numChannels = outputDims[2] ?? 2; // 2 (stereo)
        const numSamples = outputDims[3] ?? FIXED_SEGMENT_SAMPLES; // segment length
        
        // Extract vocals (stem index 2)
        const vocalsLength = numSamples;
        const interleavedVocals = new Float32Array(vocalsLength * 2);
        
        // Output is organized as: [batch][stem][channel][time]
        // We want vocals: stem=2, both channels
        // Index formula: ((batch * numStems + stem) * numChannels + channel) * numSamples + time
        const batch = 0;
        const stem = 2; // vocals
        
        for (let channel = 0; channel < numChannels; channel++) {
          for (let t = 0; t < numSamples; t++) {
            const idx = ((batch * numStems + stem) * numChannels + channel) * numSamples + t;
            const val = outputData[idx];
            if (val !== undefined) {
              // Interleave: [L0, R0, L1, R1, ...]
              interleavedVocals[t * 2 + channel] = val;
            }
          }
        }
        
        // Trim padding from the last segment
        const actualLength = segmentActualLengths[i] ?? FIXED_SEGMENT_SAMPLES;
        if (actualLength < FIXED_SEGMENT_SAMPLES) {
          // Trim to actual size (remove padding)
          const trimmedVocals = interleavedVocals.slice(0, actualLength * 2);
          vocalsSegments.push(trimmedVocals);
        } else {
          vocalsSegments.push(interleavedVocals);
        }

        console.log(`[LocalVoiceIsolator] Segment ${i + 1} completed (${actualLength} actual samples)`);
      }

      // Combine all segments
      console.log("[LocalVoiceIsolator] Combining segments...");
      const totalOutputSamples = vocalsSegments.reduce((sum, buf) => sum + Math.floor(buf.length / 2), 0);
      const combinedVocals = new Float32Array(totalOutputSamples * 2);
      let offset = 0;

      for (const buffer of vocalsSegments) {
        combinedVocals.set(buffer, offset);
        offset += buffer.length;
      }

      // Convert Float32Array back to Buffer for WAV file
      const outputBuffer = Buffer.alloc(combinedVocals.length * 4);
      for (let i = 0; i < combinedVocals.length; i++) {
        const val = combinedVocals[i];
        if (val !== undefined) {
          outputBuffer.writeFloatLE(val, i * 4);
        }
      }

      // Save as raw float32 file temporarily
      const tempVocalsRaw = path.join(tempDir, "vocals.raw");
      fsNative.writeFileSync(tempVocalsRaw, outputBuffer);

      // Convert raw float32 to WAV using ffmpeg
      console.log("[LocalVoiceIsolator] Converting to WAV...");
      const tempVocalsWav = path.join(tempDir, "vocals.wav");
      
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempVocalsRaw)
          .inputOptions([
            '-ar', String(SAMPLE_RATE),
            '-ac', '2',
            '-f', 'f32le'
          ])
          .toFormat("wav")
          .audioCodec("pcm_f32le")
          .on("end", () => resolve())
          .on("error", (err: Error) => reject(err))
          .save(tempVocalsWav);
      });

      // Convert WAV to MP3
      console.log("[LocalVoiceIsolator] Converting to MP3...");
      const outputMp3Path = path.join(tempDir, "vocals.mp3");
      
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempVocalsWav)
          .toFormat("mp3")
          .audioBitrate(320)
          .audioCodec("libmp3lame")
          .on("end", () => resolve())
          .on("error", (err: Error) => reject(err))
          .save(outputMp3Path);
      });

      // Read the MP3 file
      const resultBuffer = fsNative.readFileSync(outputMp3Path);
      
      console.log("[LocalVoiceIsolator] Processing completed successfully");
      
      return resultBuffer;

    } finally {
      // Cleanup temp directory
      fsNative.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Main method to isolate vocals from an audio file
   */
  async isolateVocals(inputPath: string): Promise<Buffer> {
    await this.loadModel();
    return await this.processAudio(inputPath);
  }
}