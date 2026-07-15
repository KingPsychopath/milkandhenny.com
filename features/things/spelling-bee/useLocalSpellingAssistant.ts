import { useCallback, useEffect, useRef, useState } from "react";
import { matchSpellingTranscript, type SpellingMatch } from "./letterMatcher";

export type AssistantStatus = "checking" | "disabled" | "loading" | "ready" | "listening" | "error";
export type AssistantBackend = "browser" | "whisper" | null;
export type BrowserSpeechAvailability = "checking" | "available" | "downloadable" | "downloading" | "unavailable";

interface WorkerEvent {
  type: "progress" | "ready" | "transcript" | "error";
  text?: string;
  error?: string;
  device?: "webgpu" | "wasm";
  progress?: { progress?: number; loaded?: number; total?: number; status?: string };
}

interface BrowserRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface BrowserRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<BrowserRecognitionResult>;
}

interface BrowserRecognition {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  processLocally: boolean;
  onresult: ((event: BrowserRecognitionEvent) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

interface BrowserRecognitionConstructor {
  new (): BrowserRecognition;
  available?: (options: { langs: string[]; processLocally: true; quality: "command" }) => Promise<Exclude<BrowserSpeechAvailability, "checking">>;
  install?: (options: { langs: string[]; processLocally: true; quality: "command" }) => Promise<boolean>;
}

function recognitionConstructor() {
  const candidate = window as Window & {
    SpeechRecognition?: BrowserRecognitionConstructor;
    webkitSpeechRecognition?: BrowserRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function supportedMimeType() {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
}

async function audioBlobTo16Khz(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * 16_000));
    const offline = new OfflineAudioContext(1, length, 16_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return new Float32Array((await offline.startRendering()).getChannelData(0));
  } finally {
    await context.close();
  }
}

function estimatedWhisperDownload() {
  const connection = (navigator as Navigator & { connection?: { downlink?: number; effectiveType?: string } }).connection;
  const downlink = connection?.downlink;
  if (typeof downlink === "number" && downlink > 0) {
    const seconds = Math.max(5, Math.ceil((50 * 8) / downlink));
    return seconds < 60 ? `about ${seconds} seconds` : `about ${Math.ceil(seconds / 60)} minutes`;
  }
  if (connection?.effectiveType === "2g") return "a few minutes";
  return "usually under a minute on Wi-Fi";
}

export function useLocalSpellingAssistant() {
  const [status, setStatus] = useState<AssistantStatus>("checking");
  const [backend, setBackend] = useState<AssistantBackend>(null);
  const [browserAvailability, setBrowserAvailability] = useState<BrowserSpeechAvailability>("checking");
  const [downloadEstimate, setDownloadEstimate] = useState("usually under a minute on Wi-Fi");
  const [progress, setProgress] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [match, setMatch] = useState<SpellingMatch>({ letters: "", matchedCount: 0, complete: false, mismatchAt: null });
  const [message, setMessage] = useState<string | null>("Checking whether this device can follow the spelling…");
  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const targetRef = useRef("");
  const transcriptRef = useRef("");
  const browserFinalRef = useRef("");
  const busyRef = useRef(false);
  const listeningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelFrameRef = useRef<number | null>(null);

  const stopLevelMonitor = useCallback(() => {
    if (levelFrameRef.current !== null) cancelAnimationFrame(levelFrameRef.current);
    levelFrameRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) void context.close();
    setInputLevel(0);
  }, []);

  const startLevelMonitor = useCallback(async (stream: MediaStream) => {
    stopLevelMonitor();
    const context = new AudioContext();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let lastUpdate = 0;
    const readLevel = (now: number) => {
      analyser.getByteTimeDomainData(samples);
      if (now - lastUpdate >= 70) {
        let sum = 0;
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128;
          sum += amplitude * amplitude;
        }
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 8);
        setInputLevel(Math.round(level * 20) / 20);
        lastUpdate = now;
      }
      levelFrameRef.current = requestAnimationFrame(readLevel);
    };
    await context.resume();
    levelFrameRef.current = requestAnimationFrame(readLevel);
  }, [stopLevelMonitor]);

  useEffect(() => {
    let active = true;
    setDownloadEstimate(estimatedWhisperDownload());
    const check = async () => {
      const Constructor = recognitionConstructor();
      if (!Constructor?.available) {
        if (active) {
          setBrowserAvailability("unavailable");
          setStatus("disabled");
          setMessage(`A one-time 50 MB setup is needed. It takes ${estimatedWhisperDownload()}.`);
        }
        return;
      }
      try {
        const availability = await Constructor.available({ langs: ["en-GB"], processLocally: true, quality: "command" });
        if (!active) return;
        setBrowserAvailability(availability);
        setStatus("disabled");
        setMessage(
          availability === "available"
            ? "Ready to turn on—nothing to download."
            : availability === "downloadable" || availability === "downloading"
              ? "A one-time speech setup is needed before this device can listen."
              : `A one-time 50 MB setup is needed. It takes ${estimatedWhisperDownload()}.`,
        );
      } catch {
        if (active) {
          setBrowserAvailability("unavailable");
          setStatus("disabled");
          setMessage(`A one-time 50 MB setup is needed. It takes ${estimatedWhisperDownload()}.`);
        }
      }
    };
    void check();
    return () => { active = false; };
  }, []);

  const stop = useCallback(() => {
    listeningRef.current = false;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopLevelMonitor();
    busyRef.current = false;
    setStatus((current) => current === "listening" ? "ready" : current);
  }, [stopLevelMonitor]);

  const disable = useCallback(async () => {
    stop();
    workerRef.current?.terminate();
    workerRef.current = null;
    const wasWhisper = backend === "whisper";
    setBackend(null);
    setStatus("disabled");
    setProgress(0);
    setMatch({ letters: "", matchedCount: 0, complete: false, mismatchAt: null });
    if (wasWhisper) {
      try {
        await caches.delete("transformers-cache");
        for (const key of await caches.keys()) if (key.startsWith("mah-optional-ai:")) await caches.delete(key);
      } catch { /* Storage may be unavailable. */ }
    }
    setMessage("Following is off.");
  }, [backend, stop]);

  const loadWhisper = useCallback(() => {
    if (workerRef.current) return;
    if (!("Worker" in window) || !("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setMessage("This browser cannot follow spoken spelling.");
      return;
    }
    setStatus("loading");
    setMessage(`Getting spoken-letter following ready—${estimatedWhisperDownload()}.`);
    const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
      const data = event.data;
      if (data.type === "progress") {
        const next = data.progress?.progress;
        if (typeof next === "number" && Number.isFinite(next)) setProgress(Math.max(0, Math.min(100, Math.round(next))));
        return;
      }
      if (data.type === "ready") {
        setBackend("whisper");
        setProgress(100);
        setStatus("ready");
        setMessage("Ready. What you say stays on this device.");
        return;
      }
      if (data.type === "error") {
        busyRef.current = false;
        setStatus("error");
        setMessage(data.error ?? "Spoken-letter following could not start.");
        return;
      }
      busyRef.current = false;
      const text = data.text?.trim();
      if (!text) return;
      transcriptRef.current = `${transcriptRef.current} ${text}`.trim();
      setMatch(matchSpellingTranscript(transcriptRef.current, targetRef.current));
    };
    worker.onerror = () => { setStatus("error"); setMessage("Spoken-letter following could not start."); };
    // Worker.postMessage has no targetOrigin argument.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    worker.postMessage({ type: "load" });
  }, []);

  const enable = useCallback(async () => {
    const Constructor = recognitionConstructor();
    if (browserAvailability === "available" && Constructor) {
      setBackend("browser");
      setStatus("ready");
      setMessage("Ready. What you say stays on this device.");
      return;
    }
    if ((browserAvailability === "downloadable" || browserAvailability === "downloading") && Constructor?.install) {
      setStatus("loading");
      setMessage("Getting spoken-letter following ready…");
      const installed = await Constructor.install({ langs: ["en-GB"], processLocally: true, quality: "command" }).catch(() => false);
      if (installed) {
        setBrowserAvailability("available");
        setBackend("browser");
        setStatus("ready");
        setMessage("Ready. What you say stays on this device.");
      } else {
        setBrowserAvailability("unavailable");
        setStatus("disabled");
        setMessage(`One more setup step is needed: about 50 MB and ${estimatedWhisperDownload()}. Tap “set up once” again.`);
      }
      return;
    }
    loadWhisper();
  }, [browserAvailability, loadWhisper]);

  const startBrowser = useCallback(async (target: string) => {
    const Constructor = recognitionConstructor();
    if (!Constructor) return;
    targetRef.current = target;
    transcriptRef.current = "";
    browserFinalRef.current = "";
    setMatch({ letters: "", matchedCount: 0, complete: false, mismatchAt: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      streamRef.current = stream;
      await startLevelMonitor(stream);
    } catch {
      setStatus("error");
      setMessage("Microphone access is blocked. Allow it in your browser, then try again.");
      return;
    }
    const recognition = new Constructor();
    recognition.processLocally = true;
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) browserFinalRef.current = `${browserFinalRef.current} ${result[0].transcript}`.trim();
        else interim += ` ${result[0].transcript}`;
      }
      const text = `${browserFinalRef.current} ${interim}`.trim();
      setMatch(matchSpellingTranscript(text, targetRef.current));
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        setMessage("Mic on · waiting to hear a letter.");
        return;
      }
      if (event.error === "aborted" && !listeningRef.current) return;
      listeningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopLevelMonitor();
      setStatus("error");
      setMessage(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access is blocked. Allow it in your browser, then try again."
          : event.error === "audio-capture"
            ? "No working microphone was found. Check this device’s audio input."
            : "Following stopped. Tap try again—the game can keep going.",
      );
    };
    recognition.onend = () => {
      if (!listeningRef.current) return;
      try {
        recognition.start();
      } catch {
        listeningRef.current = false;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        stopLevelMonitor();
        setStatus("error");
        setMessage("Following stopped. Tap try again—the game can keep going.");
      }
    };
    recognitionRef.current = recognition;
    listeningRef.current = true;
    try {
      recognition.start();
    } catch {
      listeningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopLevelMonitor();
      setStatus("error");
      setMessage("Following could not start. Tap try again or keep playing without it.");
      return;
    }
    setStatus("listening");
    setMessage("Listening and following the spelling…");
  }, [startLevelMonitor, stopLevelMonitor]);

  const startWhisper = useCallback(async (target: string) => {
    if (!workerRef.current) return;
    targetRef.current = target;
    transcriptRef.current = "";
    setMatch({ letters: "", matchedCount: 0, complete: false, mismatchAt: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      streamRef.current = stream;
      await startLevelMonitor(stream);
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = async (event) => {
        if (!workerRef.current || busyRef.current || event.data.size < 100) return;
        busyRef.current = true;
        try {
          const audio = await audioBlobTo16Khz(event.data);
          workerRef.current.postMessage({ type: "transcribe", audio }, [audio.buffer]);
        } catch { busyRef.current = false; }
      };
      recorder.start(2_200);
      setStatus("listening");
      setMessage("Listening and following the spelling…");
    } catch {
      setStatus("error");
      setMessage("Microphone access is needed for live spelling assistance.");
    }
  }, [startLevelMonitor]);

  const start = useCallback(async (target: string) => {
    if (status !== "ready") return;
    stop();
    if (backend === "browser") await startBrowser(target);
    else if (backend === "whisper") await startWhisper(target);
  }, [backend, startBrowser, startWhisper, status, stop]);

  const retry = useCallback(() => {
    stop();
    if (!backend) return;
    setStatus("ready");
    setMessage("Ready to listen again.");
  }, [backend, stop]);

  useEffect(() => () => { stop(); workerRef.current?.terminate(); }, [stop]);

  return {
    status,
    backend,
    browserAvailability,
    progress,
    inputLevel,
    match,
    message,
    downloadEstimate,
    enable,
    disable,
    start,
    stop,
    retry,
  };
}
