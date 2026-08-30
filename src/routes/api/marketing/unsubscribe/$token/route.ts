import { createFileRoute } from "@tanstack/react-router";

import { optOutByToken } from "@/features/communications/communications.server";

function page(title: string, message: string, confirm = false): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${title}</title></head><body style="margin:0;padding:48px 24px;background:#fafaf9;color:#1c1917;font:16px/1.6 Georgia,serif"><main style="max-width:560px;margin:0 auto"><p style="font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;color:#78716c">milk &amp; henny</p><h1 style="font-weight:400">${title}</h1><p>${message}</p>${confirm ? '<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit" style="min-height:48px;margin-top:16px;border:0;border-radius:3px;padding:0 20px;background:#1c1917;color:#fafaf9;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer">stop marketing emails</button></form>' : ""}</main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );
}

async function handleGET(_request: Request, _token: string) {
  return page(
    "Stop marketing emails?",
    "Confirm below. Ticket, access, payment, and event-service messages are separate and will still arrive when needed.",
    true,
  );
}

async function handlePOST(_request: Request, token: string) {
  const updated = await optOutByToken(token);
  return updated
    ? page(
        "You are unsubscribed",
        "You will no longer receive marketing emails from milk & henny. Service messages such as tickets and event changes may still be sent.",
      )
    : page(
        "This link has expired",
        "We could not find that preference link. Contact us if you need help.",
      );
}

export const Route = createFileRoute("/api/marketing/unsubscribe/$token")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.token),
      POST: ({ request, params }) => handlePOST(request, params.token),
    },
  },
});

export { handleGET as GET, handlePOST as POST };
