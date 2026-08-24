import { createFileRoute } from "@tanstack/react-router";

import { recordCommunicationLinkClick } from "@/features/communications/email-links.server";

async function handleGET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return new Response("Not found", { status: 404 });

  const destination = await recordCommunicationLinkClick(token);
  if (!destination) return new Response("This link is invalid or expired", { status: 404 });

  return new Response(null, {
    status: 302,
    headers: {
      location: destination,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

export const Route = createFileRoute("/api/communications/click")({
  server: { handlers: { GET: ({ request }) => handleGET(request) } },
});
