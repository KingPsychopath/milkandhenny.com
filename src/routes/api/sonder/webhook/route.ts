import { createFileRoute } from "@tanstack/react-router";
import { parseSonderEvent } from "@/features/sonder/types";
import { receiveSonderEvent } from "@/features/sonder/sonder.server";
import { sonderConfiguration, verifySonderSignature } from "@/lib/platform/sonder.server";

export async function handleSonderWebhook(request: Request): Promise<Response> {
  const config = sonderConfiguration();
  if (!config.mode || !config.signingSecret)
    return Response.json({ error: "Sonder is not configured" }, { status: 503 });
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/json"
  )
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  const chunks: Uint8Array[] = [],
    reader = request.body?.getReader();
  let length = 0;
  if (reader)
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 1_048_576) {
        await reader.cancel();
        return Response.json({ error: "Payload too large" }, { status: 413 });
      }
      chunks.push(next.value);
    }
  const raw = Buffer.concat(chunks);
  if (!verifySonderSignature(raw, request.headers.get("Sonder-Signature"), config.signingSecret))
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  let event;
  try {
    event = parseSonderEvent(
      JSON.parse(raw.toString("utf8")),
      request.headers.get("Sonder-Event-Id") ?? "",
      config.mode,
    );
  } catch {
    return Response.json({ error: "Invalid event" }, { status: 400 });
  }
  try {
    return Response.json({ received: true, ...(await receiveSonderEvent(event)) });
  } catch {
    return Response.json({ error: "Event could not be saved" }, { status: 503 });
  }
}
export const Route = createFileRoute("/api/sonder/webhook")({
  server: { handlers: { POST: ({ request }) => handleSonderWebhook(request) } },
});
