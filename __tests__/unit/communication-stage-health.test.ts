import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CommunicationStageHealth,
  communicationStageLifecyclePresentation,
} from "@/features/admin/ui/components/CommunicationStageHealth";

describe("communication stage health", () => {
  it("should keep lifecycle success green and report recipient issues separately", () => {
    expect(
      communicationStageLifecyclePresentation(
        { status: "complete", deliveryState: "complete with issues", lastError: null },
        false,
      ),
    ).toEqual({ label: "complete", tone: "positive" });
  });

  it("should prefer completed recipient evidence over a stale queued lifecycle", () => {
    expect(
      communicationStageLifecyclePresentation(
        {
          status: "queued",
          deliveryState: "queued",
          lastError: null,
          audienceCount: 77,
          receivedCount: 77,
          missingRecipientCount: 0,
        },
        false,
      ),
    ).toEqual({ label: "complete", tone: "positive" });
  });

  it("should lead with current delivery health and separate historical records", () => {
    const html = renderToStaticMarkup(
      createElement(CommunicationStageHealth, {
        deliveryEventsConfigured: true,
        stage: {
          recipientCount: 79,
          audienceCount: 75,
          receivedCount: 75,
          missingRecipientCount: 0,
          delivery: {
            queued: 0,
            accepted: 0,
            delivered: 75,
            deferred: 0,
            failed: 0,
            bounced: 0,
            rejected: 0,
            complained: 0,
            skipped: 0,
          },
          linkClicks: [
            { linkKey: "things-pitches-new", uniqueRecipients: 2, totalClicks: 2 },
            { linkKey: "things-spelling-bee", uniqueRecipients: 5, totalClicks: 6 },
          ],
        },
      }),
    );

    expect(html).toContain("75 / 75 received");
    expect(html).not.toContain("delivered 75");
    expect(html).toContain("clicked 7");
    expect(html).toContain("4 historical delivery records");
    expect(html).toContain("new pitches 2");
    expect(html).toContain("spelling bee 5");
    expect(html).not.toContain("accepted 0");
    expect(html).not.toContain("things-pitches-new");
    expect(html).not.toContain("needs attention");
  });

  it("should keep a current delivery failure prominent", () => {
    const html = renderToStaticMarkup(
      createElement(CommunicationStageHealth, {
        deliveryEventsConfigured: true,
        stage: {
          recipientCount: 75,
          audienceCount: 75,
          receivedCount: 74,
          missingRecipientCount: 0,
          delivery: {
            queued: 0,
            accepted: 0,
            delivered: 74,
            deferred: 0,
            failed: 1,
            bounced: 0,
            rejected: 0,
            complained: 0,
            skipped: 0,
          },
          linkClicks: [],
        },
      }),
    );

    expect(html).toContain("74 / 75 received · 1 delivery needs attention");
    expect(html.match(/needs attention/g)).toHaveLength(1);
    expect(html).not.toContain("historical delivery");
  });
});
