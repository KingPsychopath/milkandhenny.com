export interface StoredInboxView {
  name: string;
  status: string;
  severity: string;
  category: string;
  event: string;
}

const MAX_SAVED_INBOX_VIEWS = 20;

export function parseSavedInboxViews(raw: string | null): StoredInboxView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is StoredInboxView => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const view = entry as Record<string, unknown>;
        return (
          typeof view.name === "string" &&
          view.name.trim().length > 0 &&
          view.name.length <= 80 &&
          typeof view.status === "string" &&
          typeof view.severity === "string" &&
          typeof view.category === "string" &&
          typeof view.event === "string"
        );
      })
      .slice(-MAX_SAVED_INBOX_VIEWS);
  } catch {
    return [];
  }
}
