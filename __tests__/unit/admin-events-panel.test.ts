import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EventsPanel } from "@/features/admin/ui/components/EventsPanel";
import { permissionsForGlobalRole } from "@/features/attendee-operations/types";

describe("admin events panel", () => {
  it("shows an initial loading state instead of a false empty state", () => {
    const html = renderToStaticMarkup(
      createElement(EventsPanel, {
        authFetch: async () => new Response(),
        onError: () => undefined,
        onStatus: () => undefined,
        ensureStepUpToken: async () => ({ ok: false as const, cancelled: true as const }),
        withStepUpHeaders: (_token: string, extra: Record<string, string> = {}) => extra,
        permissions: permissionsForGlobalRole("support"),
      }),
    );

    expect(html).toContain("loading events…");
    expect(html).not.toContain("no events yet");
  });
});
