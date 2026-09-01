import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EventsPanel } from "@/features/admin/ui/components/EventsPanel";
import { ScoringStaffPanel } from "@/features/admin/ui/components/ScoringStaffPanel";
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

  it("renders identity-first staff access and keeps shared stations explicit", () => {
    const expiresAt = "2026-09-02T02:00:00.000Z";
    const role = {
      id: "role-door",
      label: "front door",
      rolePreset: "door-scanner",
      permissions: { admitTickets: true },
      scope: {},
      expiresAt,
      status: "active" as const,
    };
    const html = renderToStaticMarkup(
      createElement(ScoringStaffPanel, {
        eventSlug: "tomorrow-night",
        activities: [],
        checkpoints: [{ id: "food", name: "food collection" }],
        roles: [role],
        staff: [
          {
            id: "assignment-person",
            roleId: role.id,
            label: "Alex",
            assignmentType: "personal" as const,
            status: "active",
            invitationState: "active",
            permissions: role.permissions,
            scope: {},
            assignedEmailHint: "a***@example.com",
            invitationDelivery: "direct" as const,
            devices: [],
          },
          {
            id: "assignment-station",
            roleId: role.id,
            label: "spare door phone",
            assignmentType: "station" as const,
            status: "active",
            permissions: role.permissions,
            scope: {},
            invitationDelivery: "station" as const,
            devices: [],
          },
          {
            id: "assignment-old",
            roleId: role.id,
            label: "Old helper",
            assignmentType: "personal" as const,
            status: "revoked",
            invitationState: "revoked",
            permissions: role.permissions,
            scope: {},
            invitedEmailHint: "o***@example.com",
            invitationDelivery: "email" as const,
            devices: [],
          },
          {
            id: "assignment-pending",
            roleId: role.id,
            label: "Invited helper",
            assignmentType: "personal" as const,
            status: "active",
            invitationState: "pending",
            permissions: role.permissions,
            scope: {},
            invitedEmailHint: "i***@example.com",
            invitationDelivery: "email" as const,
            devices: [],
          },
        ],
        onAction: async () => null,
        defaultPreset: "door-scanner" as const,
      }),
    );

    expect(html).toContain("Roles that match the night");
    expect(html).toContain("a***@example.com");
    expect(html).toContain("shared station");
    expect(html).toContain("Who has access now");
    expect(html).toContain("recent access history · 1");
    expect(html).toContain("credentials no longer work");
    expect(html).toContain("cancel invite");
    expect(html).toContain("older link is revoked automatically");
    expect(html).toContain("add someone");
    expect(html).toContain("check guests in at entry");
  });
});
