import { createFileRoute } from "@tanstack/react-router";
import { exchangeCliAuthorizationCode } from "@/features/auth/cli-auth.server";

async function handlePOST(request: Request) {
  let body: { code?: unknown; codeVerifier?: unknown };
  try {
    body = (await request.json()) as { code?: unknown; codeVerifier?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.code !== "string" || typeof body.codeVerifier !== "string") {
    return Response.json({ error: "code and codeVerifier are required" }, { status: 400 });
  }

  const token = await exchangeCliAuthorizationCode({
    code: body.code,
    codeVerifier: body.codeVerifier,
  });
  if (!token)
    return Response.json({ error: "Invalid or expired CLI authorization" }, { status: 401 });
  return Response.json({ ok: true, token }, { headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/admin/cli-auth/exchange")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
