/// <reference lib="webworker" />

import { env, pipeline } from "@huggingface/transformers";

interface ProgressEvent {
  progress?: number;
  loaded?: number;
  total?: number;
  status?: string;
}

interface Transcriber {
  (audio: Float32Array, options?: Record<string, unknown>): Promise<unknown>;
}

let transcriber: Transcriber | null = null;
env.useBrowserCache = true;
env.allowLocalModels = false;
env.allowRemoteModels = true;

self.onmessage = async (event: MessageEvent<{ type: "load" } | { type: "transcribe"; audio: Float32Array }>) => {
  try {
    if (event.data.type === "load") {
      const progressCallback = (progress: ProgressEvent) => self.postMessage({ type: "progress", progress });
      let device: "webgpu" | "wasm" = "gpu" in navigator ? "webgpu" : "wasm";
      let created: unknown;
      try {
        created = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
          dtype: "q8",
          device,
          progress_callback: progressCallback,
        });
      } catch (error) {
        if (device !== "webgpu") throw error;
        device = "wasm";
        created = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
          dtype: "q8",
          device,
          progress_callback: progressCallback,
        });
      }
      transcriber = created as unknown as Transcriber;
      self.postMessage({ type: "ready", device });
      return;
    }
    if (!transcriber) throw new Error("Speech model is not ready");
    const output = await transcriber(event.data.audio, { language: "english", task: "transcribe" });
    const text = output && typeof output === "object" && "text" in output && typeof output.text === "string" ? output.text : "";
    self.postMessage({ type: "transcript", text });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : "Local speech failed" });
  }
};
