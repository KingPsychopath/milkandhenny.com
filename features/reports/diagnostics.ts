import type {
  DiagnosticAction,
  DiagnosticContext,
  DiagnosticError,
  ReportDiagnosticsInput,
} from "./types";

const MAX_TRAIL_ITEMS = 20;
const diagnosticTrail: DiagnosticAction[] = [];

function safeValue(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .slice(0, 120);
}

function safeData(data: Record<string, boolean | number | string | null> | undefined) {
  if (!data) return undefined;
  const result: Record<string, boolean | number | string | null> = {};
  for (const [key, value] of Object.entries(data).slice(0, 8)) {
    result[key.slice(0, 80)] = typeof value === "string" ? safeValue(value) : value;
  }
  return result;
}

export function newDiagnosticId() {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "")
      : Math.random().toString(36).slice(2);
  return `diag_${id}`;
}

export function recordDiagnosticAction(
  name: string,
  data?: Record<string, boolean | number | string | null>,
) {
  diagnosticTrail.push({
    at: new Date().toISOString(),
    name: safeValue(name),
    ...(safeData(data) ? { data: safeData(data) } : {}),
  });
  if (diagnosticTrail.length > MAX_TRAIL_ITEMS)
    diagnosticTrail.splice(0, diagnosticTrail.length - MAX_TRAIL_ITEMS);
}

function diagnosticError(error: unknown): DiagnosticError | undefined {
  if (error instanceof Error) {
    return import.meta.env.DEV
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: error.name };
  }
  if (typeof error === "string") {
    return import.meta.env.DEV ? { name: "Error", message: error } : { name: "Error" };
  }
  return error === undefined ? undefined : { name: "UnknownError" };
}

export function captureDiagnosticContext(
  input: {
    diagnosticId?: string;
    error?: unknown;
  } = {},
): ReportDiagnosticsInput {
  const viewport =
    typeof window === "undefined"
      ? undefined
      : {
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: window.devicePixelRatio || 1,
        };
  const device =
    typeof navigator === "undefined"
      ? undefined
      : {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          viewport,
          touch: navigator.maxTouchPoints > 0,
          online: navigator.onLine,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
  const route = typeof location === "undefined" ? "/" : location.pathname;
  const context: DiagnosticContext = {
    schemaVersion: 1,
    diagnosticId: input.diagnosticId ?? newDiagnosticId(),
    buildId: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "unknown",
    route,
    device: device ?? {},
    trail: diagnosticTrail.slice(-12),
  };
  const errorDetails = diagnosticError(input.error);
  if (errorDetails) context.error = errorDetails;
  return context;
}
