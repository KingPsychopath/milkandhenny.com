import { createFileRoute } from "@tanstack/react-router";

import { optOutByToken } from "@/features/communications/communications.server";

async function handleGET(_request: Request, token: string) {
  const updated = await optOutByToken(token);
  const title = updated ? "You are unsubscribed" : "This link has expired";
  const message = updated
    ? "You will no longer receive marketing emails from milk & henny. Service messages such as tickets and event changes may still be sent."
    : "We could not find that preference link. Contact us if you need help.";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body style="margin:0;padding:48px 24px;background:#fafaf9;color:#1c1917;font:16px/1.6 Georgia,serif"><main style="max-width:560px;margin:0 auto"><p style="font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;color:#78716c">milk &amp; henny</p><h1 style="font-weight:400">${title}</h1><p>${message}</p></main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/marketing/unsubscribe/$token")({
  server: { handlers: { GET: ({ request, params }) => handleGET(request, params.token) } },
});
