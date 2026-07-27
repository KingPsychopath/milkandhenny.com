/**
 * Which job a running instance of the server image is doing.
 *
 * The web service and the media worker deploy the *same* build artifact with
 * the same start command; only `MEDIA_WORKER_ROLE` differs. That keeps one
 * Dockerfile, one build, and no chance of the worker drifting from the app
 * code it shares.
 */
const MEDIA_ROLES = ["web", "worker"] as const;
type MediaRole = (typeof MEDIA_ROLES)[number];

function getMediaRole(): MediaRole {
  const raw = (process.env.MEDIA_WORKER_ROLE ?? "web").trim().toLowerCase();
  if (raw === "web" || raw === "worker") return raw;
  throw new Error(`Unsupported MEDIA_WORKER_ROLE "${raw}". Configure web or worker.`);
}

/** True when this instance should drain the media queues instead of only serving requests. */
function isMediaWorkerRole(): boolean {
  return getMediaRole() === "worker";
}

export { getMediaRole, isMediaWorkerRole, MEDIA_ROLES };
export type { MediaRole };
