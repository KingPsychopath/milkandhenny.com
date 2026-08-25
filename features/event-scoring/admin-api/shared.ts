export type AdminScoringActionContext = {
  request: Request;
  eventSlug: string;
  actorId: string;
  body: Record<string, unknown>;
};

export type AdminScoringActionHandler = (context: AdminScoringActionContext) => Promise<Response>;

export type AdminScoringActionHandlers = Record<string, AdminScoringActionHandler>;

export function recordBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringsValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function resultResponse<T>(
  result: { ok: true; value: T } | { ok: false; status: number; error: string },
  key: string,
  status?: number,
): Response {
  return result.ok
    ? Response.json({ [key]: result.value }, status ? { status } : undefined)
    : Response.json({ error: result.error }, { status: result.status });
}
