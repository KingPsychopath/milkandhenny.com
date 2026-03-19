type ResponsePayload = {
  text: string;
  json: unknown | null;
};

async function readResponsePayload(response: Response): Promise<ResponsePayload> {
  const text = await response.text();
  if (!text) return { text, json: null };

  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    return { text, json: null };
  }
}

function getResponseErrorMessage(payload: ResponsePayload, fallback: string): string {
  if (payload.json && typeof payload.json === "object" && "error" in payload.json) {
    const error = (payload.json as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }

  const text = payload.text.trim();
  return text || fallback;
}

export { getResponseErrorMessage, readResponsePayload };
export type { ResponsePayload };
