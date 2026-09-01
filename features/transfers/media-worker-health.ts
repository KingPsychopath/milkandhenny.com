type MediaWorkerHealthSnapshot = {
  lastHeartbeatAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
};

function summarizeMediaWorkerError(raw: string): string {
  if (/command timed out/i.test(raw)) {
    return "Redis queue wait timed out; reconnecting automatically.";
  }
  if (/connection (?:is )?closed|connection closed/i.test(raw)) {
    return "Redis queue connection closed; reconnecting automatically.";
  }

  const firstLine = raw
    .split("\n", 1)[0]
    ?.replace(/^Error:\s*/i, "")
    .trim();
  return (firstLine || "The media worker was interrupted.").slice(0, 240);
}

function mediaWorkerErrorIsActive(worker: MediaWorkerHealthSnapshot): boolean {
  if (!worker.lastErrorMessage) return false;
  const errorAt = worker.lastErrorAt ? Date.parse(worker.lastErrorAt) : Number.NaN;
  const heartbeatAt = worker.lastHeartbeatAt ? Date.parse(worker.lastHeartbeatAt) : Number.NaN;
  if (!Number.isFinite(errorAt) || !Number.isFinite(heartbeatAt)) return true;
  return heartbeatAt <= errorAt;
}

export { mediaWorkerErrorIsActive, summarizeMediaWorkerError };
export type { MediaWorkerHealthSnapshot };
