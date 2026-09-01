import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EventsPanel } from "@/features/admin/ui/components/EventsPanel";
import { ScoringStaffPanel } from "@/features/admin/ui/components/ScoringStaffPanel";
import { StaffRoleAccess } from "@/features/admin/ui/components/StaffAccessRegister";
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
    const staff = [
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
    ];
    const html = renderToStaticMarkup(
      createElement(ScoringStaffPanel, {
        eventSlug: "tomorrow-night",
        activities: [],
        checkpoints: [{ id: "food", name: "food collection" }],
        roles: [role],
        staff,
        onAction: async () => null,
        defaultPreset: "door-scanner" as const,
      }),
    );
    const accessHtml = renderToStaticMarkup(
      createElement(StaffRoleAccess, {
        role,
        staff,
        onAction: async () => null,
      }),
    );

    expect(html).toContain("Roles that match the night");
    expect(html).toContain("role &amp; access");
    expect(html).toContain("manage ↓");
    expect(accessHtml).toContain("a***@example.com");
    expect(accessHtml).toContain("shared station");
    expect(accessHtml).toContain("who has this role now");
    expect(accessHtml).toContain("recent access history · 1");
    expect(accessHtml).toContain("no longer work");
    expect(accessHtml).toContain("cancel invite");
    expect(accessHtml).toContain("older link is revoked automatically");
    expect(html).toContain("check guests in at entry");
  });
});
