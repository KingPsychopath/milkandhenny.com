import {
  AdminStatus,
  adminToneForStatus,
  adminToneTextClass,
  type AdminStatusTone,
} from "./AdminStatus";

interface DeliveryCounts {
  queued: number;
  accepted: number;
  delivered: number;
  deferred: number;
  failed: number;
  bounced: number;
  rejected: number;
  complained: number;
  skipped: number;
}

interface LinkMetric {
  linkKey: string;
  uniqueRecipients: number;
  totalClicks: number;
}

interface StageHealth {
  recipientCount: number;
  audienceCount: number;
  receivedCount: number;
  missingRecipientCount: number;
  delivery: DeliveryCounts;
  linkClicks: LinkMetric[];
}

interface StageLifecycle {
  status: string;
  deliveryState: string;
  lastError: string | null;
  audienceCount?: number;
  receivedCount?: number;
  missingRecipientCount?: number;
}

const FRIENDLY_LINK_LABELS: Record<string, string> = {
  "things-pitches-new": "new pitches",
  "things-spelling-bee": "spelling bee",
};

function currentAudienceFullyReceived(stage: {
  audienceCount?: number;
  receivedCount?: number;
  missingRecipientCount?: number;
}): boolean {
  return (
    (stage.audienceCount ?? 0) > 0 &&
    (stage.receivedCount ?? 0) >= (stage.audienceCount ?? 0) &&
    (stage.missingRecipientCount ?? 0) === 0
  );
}

export function communicationStageLifecyclePresentation(
  stage: StageLifecycle,
  needsManualAction: boolean,
): { label: string; tone: AdminStatusTone } {
  if (needsManualAction) {
    return { label: "overdue — waiting for your decision", tone: "attention" };
  }
  if (stage.lastError && stage.lastError !== "send window passed") {
    return { label: "stage error", tone: "danger" };
  }
  if (currentAudienceFullyReceived(stage)) {
    return { label: "complete", tone: "positive" };
  }

  switch (stage.deliveryState) {
    case "queued":
      return { label: "queued for sending", tone: "attention" };
    case "accepted":
      return { label: "accepted · awaiting delivery confirmation", tone: "attention" };
    case "delivered":
    case "complete with issues":
      return { label: "complete", tone: "positive" };
    case "preparing":
      return { label: "preparing", tone: "attention" };
    default:
      return {
        label: stage.deliveryState,
        tone: adminToneForStatus(stage.deliveryState || stage.status),
      };
  }
}

function deliveryIssues(delivery: DeliveryCounts): number {
  return delivery.failed + delivery.bounced + delivery.rejected + delivery.complained;
}

function historicalDeliveryCount(stage: StageHealth): number {
  const currentDeliveryRecords = stage.audienceCount - stage.missingRecipientCount;
  return Math.max(0, stage.recipientCount - currentDeliveryRecords);
}

function audienceTone(stage: StageHealth): AdminStatusTone {
  if (deliveryIssues(stage.delivery) > 0) return "danger";
  if (currentAudienceFullyReceived(stage)) return "positive";
  if (
    stage.missingRecipientCount > 0 ||
    stage.delivery.queued > 0 ||
    stage.delivery.deferred > 0 ||
    stage.delivery.accepted > 0
  ) {
    return "attention";
  }
  return "neutral";
}

function audienceLabel(stage: StageHealth, deliveryEventsConfigured: boolean): string {
  const issues = deliveryIssues(stage.delivery);
  if (stage.audienceCount === 0) return "no current attendees";
  const receivedLabel = `${Math.min(stage.receivedCount, stage.audienceCount)} / ${stage.audienceCount} received`;
  if (issues > 0) {
    return `${receivedLabel} · ${issues} deliver${issues === 1 ? "y" : "ies"} need${issues === 1 ? "s" : ""} attention${stage.missingRecipientCount > 0 ? ` · ${stage.missingRecipientCount} not yet sent` : ""}`;
  }
  if (stage.missingRecipientCount > 0) {
    return `${receivedLabel} · ${stage.missingRecipientCount} not yet sent`;
  }
  if (currentAudienceFullyReceived(stage)) {
    return receivedLabel;
  }
  if (stage.delivery.queued > 0 || stage.delivery.deferred > 0) {
    return `${receivedLabel} · sending`;
  }
  if (stage.delivery.accepted > 0) {
    return `${receivedLabel} · ${stage.delivery.accepted} awaiting confirmation`;
  }
  if (!deliveryEventsConfigured) {
    return `${stage.audienceCount - stage.missingRecipientCount} / ${stage.audienceCount} sent · confirmation unavailable`;
  }
  return receivedLabel;
}

function linkLabel(linkKey: string): string {
  const friendly = FRIENDLY_LINK_LABELS[linkKey];
  if (friendly) return friendly;
  if (linkKey.startsWith("media-")) return "video";
  return linkKey.replaceAll("-", " ");
}

export function communicationLinkMetricsLabel(links: LinkMetric[]): string {
  const clickedLinks = links.filter((link) => link.uniqueRecipients > 0);
  if (clickedLinks.length === 0) return "";
  return `link clicks · ${clickedLinks
    .map((link) => `${linkLabel(link.linkKey)} ${link.uniqueRecipients}`)
    .join(" · ")}`;
}

export function CommunicationStageHealth({
  stage,
  deliveryEventsConfigured,
}: {
  stage: StageHealth;
  deliveryEventsConfigured: boolean;
}) {
  const historical = historicalDeliveryCount(stage);
  const clicked = stage.linkClicks.reduce((total, link) => total + link.uniqueRecipients, 0);
  const clickLabel = communicationLinkMetricsLabel(stage.linkClicks);
  const fullyReceived = currentAudienceFullyReceived(stage);

  return (
    <div className="mt-3 font-mono">
      <AdminStatus tone={audienceTone(stage)} className="text-xs">
        {audienceLabel(stage, deliveryEventsConfigured)}
      </AdminStatus>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-micro theme-muted">
        {!fullyReceived && stage.delivery.accepted > 0 ? (
          <span className={adminToneTextClass("attention")}>
            awaiting confirmation {stage.delivery.accepted}
          </span>
        ) : null}
        {!fullyReceived && stage.delivery.queued > 0 ? (
          <span className={adminToneTextClass("attention")}>queued {stage.delivery.queued}</span>
        ) : null}
        {!fullyReceived && stage.delivery.deferred > 0 ? (
          <span className={adminToneTextClass("attention")}>
            retrying {stage.delivery.deferred}
          </span>
        ) : null}
        {stage.delivery.skipped > 0 ? <span>skipped {stage.delivery.skipped}</span> : null}
        {clicked > 0 ? <span>clicked {clicked}</span> : null}
        {historical > 0 ? (
          <span>
            {historical} historical delivery record{historical === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {clickLabel ? <p className="mt-1 text-micro theme-faint">{clickLabel}</p> : null}
    </div>
  );
}
