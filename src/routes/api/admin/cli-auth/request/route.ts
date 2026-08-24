import { createFileRoute } from "@tanstack/react-router";
import { getClientIp } from "@/features/auth/auth.server";
import { createCliAuthorizationRequest } from "@/features/auth/cli-auth.server";

type RequestBody = {
  redirectUri?: unknown;
  codeChallenge?: unknown;
  state?: unknown;
};

async function handlePOST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body.redirectUri !== "string" ||
    typeof body.codeChallenge !== "string" ||
    typeof body.state !== "string"
  ) {
    return Response.json(
      { error: "redirectUri, codeChallenge, and state are required" },
      { status: 400 },
    );
  }

  const result = await createCliAuthorizationRequest({
    redirectUri: body.redirectUri,
    codeChallenge: body.codeChallenge,
    state: body.state,
    ip: getClientIp(request),
    ua: request.headers.get("user-agent") ?? "milkandhenny-cli",
    browserUrlOrigin: new URL(request.url).origin,
  });
  if (!result) {
    return Response.json({ error: "CLI authorization is unavailable" }, { status: 503 });
  }

  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/admin/cli-auth/request")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
