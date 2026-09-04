"use client";

import { AdminTextField as Field } from "./AdminTextField";

import { useState, type FormEvent } from "react";
import { AppSelect, type AppSelectOption } from "@/components/AppSelect";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { ADMIN_ACTIVE_REFRESH_WINDOW_MS } from "@/features/admin/ui/hooks/useAdminAutoRefresh";
import { AdminFormAction } from "./AdminFormAction";
import {
  CommunicationStageHealth,
  communicationLinkMetricsLabel,
  communicationStageLifecyclePresentation,
} from "./CommunicationStageHealth";

import {
  CommunicationMessageEditor,
  type CommunicationMediaDraft,
  type CommunicationPreviewValues,
} from "./CommunicationMessageEditor";
import {
  AdminStatus,
  adminToneForStatus,
  adminToneTextClass,
  type AdminStatusTone,
} from "./AdminStatus";

export type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
export type Kind = "newsletter" | "event_update" | "pitch_nudge" | "event_service" | "feedback";
export type Audience = "marketing_opted_in" | "event_attendees" | "pitch_owners" | "selected";
export type MediaKind = CommunicationMediaDraft["kind"];
export type Contact = {
  emailHash: string;
  email: string;
  displayName: string | null;
  sources: string[];
  marketingOptedIn: boolean;
  marketingConsentSource: string | null;
  marketingConsentDecision: "granted" | "withdrawn" | null;
  marketingConsentAt: string | null;
  marketingConsentVersion: string | null;
  marketingConsentPrivacyVersion: string | null;
};
export type EventOption = { slug: string; title: string; startsAt: string };
export type Message = {
  id: string;
  kind: Kind;
  audience: string;
  subject: string;
  scheduledAt: string | null;
  status: string;
  recipientCount: number;
  delivery: DeliveryCounts;
  linkClicks: LinkMetric[];
};
export type EmailCapability = {
  provider: "cloudflare" | "mailpit" | null;
  mailpitUrl: string | null;
  deliveryEventsConfigured?: boolean;
  linkTrackingConfigured?: boolean;
};
export type DeliveryCounts = {
  queued: number;
  accepted: number;
  delivered: number;
  deferred: number;
  failed: number;
  bounced: number;
  rejected: number;
  complained: number;
  skipped: number;
};
export type LinkMetric = { linkKey: string; uniqueRecipients: number; totalClicks: number };
export type Media = { kind: MediaKind; url: string; alt: string; posterUrl?: string };
export type Template = {
  id: string;
  updatedAt: string;
  name: string;
  kind: Kind;
  subject: string;
  body: string;
  media: Media[];
  isDefault: boolean;
};
export type Stage = {
  id: string;
  updatedAt: string;
  stageKey: string;
  label: string;
  position: number;
  kind: Kind;
  audience: Audience;
  subject: string;
  body: string;
  media: Media[];
  templateName: string | null;
  sendAt: string | null;
  status: string;
  deliveryState: string;
  recipientCount: number;
  audienceCount: number;
  receivedCount: number;
  missingRecipientCount: number;
  deliveryUpdatedAt: string | null;
  queuedCount: number;
  lastError: string | null;
  surveyId: string | null;
  delivery: DeliveryCounts;
  linkClicks: LinkMetric[];
};
export type StageDelivery = {
  emailHash: string;
  email: string;
  displayName: string | null;
  isCurrentRecipient: boolean;
  deliveryStatus: string;
  outboxStatus: string | null;
  attempts: number;
  lastError: string | null;
  providerDeliveryStatus: string | null;
  nextAttemptAt: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
};
export type Plan = {
  id: string;
  eventSlug: string;
  eventTitle: string;
  name: string;
  status: string;
  stages: Stage[];
};
export type SurveyQuestion = {
  id: string;
  type: "rating" | "long_text" | "single_choice" | "multi_choice" | "yes_no" | "email";
  label: string;
  hint?: string;
  required: boolean;
  options?: string[];
};
export type Survey = {
  id: string;
  slug: string;
  eventSlug: string | null;
  title: string;
  intro: string;
  questions: SurveyQuestion[];
  identityMode: "anonymous" | "optional" | "identified";
  status: "draft" | "open" | "closed" | "archived";
  responseCount: number;
  invitations: { issued: number; opened: number; completed: number };
};
export type SurveyResponse = {
  id: string;
  respondentEmail: string | null;
  respondentName: string | null;
  identitySource: "anonymous" | "provided" | "invitation";
  answers: Record<string, string | string[]>;
  submittedAt: string;
};
export type SurveyInvitation = {
  id: string;
  respondentEmail: string;
  respondentName: string | null;
  openedAt: string | null;
  completedAt: string | null;
  completionMode: "anonymous" | "identified" | null;
  expiresAt: string;
};
export type StageDraft = {
  expectedUpdatedAt?: string;
  originalSendAt?: string | null;
  subject: string;
  body: string;
  sendAt: string;
  mediaUrl: string;
  mediaKind: MediaKind;
  mediaAlt: string;
  posterUrl: string;
};
export type TemplateDraft = {
  expectedUpdatedAt?: string;
  id: string;
  name: string;
  kind: Kind;
  subject: string;
  body: string;
  mediaUrl: string;
  mediaKind: MediaKind;
  mediaAlt: string;
  posterUrl: string;
  isDefault: boolean;
};
export type SurveyDraft = {
  id: string;
  slug: string;
  eventSlug: string;
  title: string;
  intro: string;
  identityMode: Survey["identityMode"];
  status: Survey["status"];
  questions: SurveyQuestion[];
};

export const KIND_LABELS: Record<Kind, string> = {
  newsletter: "newsletter",
  event_update: "event update",
  pitch_nudge: "pitch nudge",
  event_service: "event logistics",
  feedback: "feedback",
};

export const KIND_OPTIONS: readonly AppSelectOption[] = Object.entries(KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
);
export const SURVEY_STATUS_OPTIONS: readonly AppSelectOption[] = [
  { value: "draft", label: "draft" },
  { value: "open", label: "open" },
  { value: "closed", label: "closed" },
];
export const SURVEY_IDENTITY_OPTIONS: readonly AppSelectOption[] = [
  { value: "identified", label: "personal — link answers to each invitee" },
  { value: "optional", label: "optional — invitee can answer anonymously" },
  { value: "anonymous", label: "anonymous — never collect identity" },
];
export const QUESTION_TYPE_OPTIONS: readonly AppSelectOption[] = [
  { value: "rating", label: "1–5 rating" },
  { value: "long_text", label: "long answer" },
  { value: "yes_no", label: "yes / no" },
  { value: "single_choice", label: "one choice" },
  { value: "multi_choice", label: "several choices" },
  { value: "email", label: "email" },
];

export function dateLabel(value: string | null): string {
  if (!value) return "not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unknown time"
    : date.toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
      });
}

export function stageHasReachedSendTime(stage: Stage): boolean {
  if (!stage.sendAt) return false;
  const sendAt = Date.parse(stage.sendAt);
  return !Number.isNaN(sendAt) && sendAt <= Date.now();
}

export function stageExpiredWithoutSending(stage: Stage): boolean {
  return (
    stage.status === "complete" &&
    stage.queuedCount === 0 &&
    stage.lastError === "send window passed"
  );
}

export function stageNeedsManualSendDecision(stage: Stage): boolean {
  return (
    stageExpiredWithoutSending(stage) ||
    (stageHasReachedSendTime(stage) && (stage.status === "draft" || stage.status === "paused"))
  );
}

export function canSendStageNow(stage: Stage): boolean {
  return (
    stageExpiredWithoutSending(stage) || ["draft", "scheduled", "paused"].includes(stage.status)
  );
}

export function stageCanEdit(stage: Stage): boolean {
  return (
    stageExpiredWithoutSending(stage) || ["draft", "scheduled", "paused"].includes(stage.status)
  );
}

export function consentSourceLabel(source: string | null): string {
  switch (source) {
    case "ticket_purchase":
      return "ticket purchase";
    case "subscribe":
      return "subscribe page";
    case "unsubscribe":
      return "unsubscribe link";
    case "admin":
      return "admin action";
    default:
      return "unknown source";
  }
}

export function consentLabel(contact: Contact): string {
  if (!contact.marketingConsentAt) return "no marketing choice recorded";
  const decision = contact.marketingConsentDecision === "granted" ? "opted in" : "opted out";
  const copyVersion = contact.marketingConsentVersion
    ? ` · ${contact.marketingConsentVersion}`
    : "";
  return `${decision} · ${consentSourceLabel(contact.marketingConsentSource)} · ${dateLabel(contact.marketingConsentAt)}${copyVersion}`;
}

export function MessageDeliveryMetrics({
  delivery,
  links,
}: {
  delivery: DeliveryCounts;
  links: LinkMetric[];
}) {
  const clicked = links.reduce((total, link) => total + link.uniqueRecipients, 0);
  const issues = delivery.failed + delivery.bounced + delivery.rejected + delivery.complained;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 theme-muted">
      {delivery.accepted > 0 ? <span>awaiting confirmation {delivery.accepted}</span> : null}
      {delivery.delivered > 0 ? (
        <span className={adminToneTextClass("positive")}>delivered {delivery.delivered}</span>
      ) : null}
      {delivery.deferred > 0 ? (
        <span className={adminToneTextClass("attention")}>retrying {delivery.deferred}</span>
      ) : null}
      {issues > 0 ? (
        <span className={adminToneTextClass("danger")}>needs attention {issues}</span>
      ) : null}
      {delivery.skipped > 0 ? <span>skipped {delivery.skipped}</span> : null}
      {clicked > 0 ? <span>clicked {clicked}</span> : null}
    </span>
  );
}

export function deliveryStatusLabel(row: StageDelivery): string {
  if (!row.isCurrentRecipient) return "superseded · historical address";
  if (row.deliveryStatus === "delivered") return "delivered";
  if (row.deliveryStatus === "accepted") return "accepted · awaiting confirmation";
  if (row.deliveryStatus === "queued") {
    return row.outboxStatus === "processing" ? "sending" : "queued";
  }
  if (row.deliveryStatus === "deferred") return "deferred · retrying";
  if (row.deliveryStatus === "skipped") return "skipped";
  return row.deliveryStatus;
}

export function deliveryStatusTone(row: StageDelivery): AdminStatusTone {
  if (!row.isCurrentRecipient) return "neutral";
  switch (row.deliveryStatus) {
    case "delivered":
    case "accepted":
      return "positive";
    case "queued":
    case "deferred":
      return "attention";
    case "failed":
    case "bounced":
    case "rejected":
    case "complained":
      return "danger";
    case "skipped":
      return "neutral";
    default:
      return adminToneForStatus(row.outboxStatus ?? row.deliveryStatus);
  }
}

export function stageHasRecentUnsettledDelivery(
  stage: Stage,
  deliveryEventsConfigured: boolean,
  now = Date.now(),
): boolean {
  if (!stage.deliveryUpdatedAt) return false;
  const updatedAt = Date.parse(stage.deliveryUpdatedAt);
  if (Number.isNaN(updatedAt) || now - updatedAt > ADMIN_ACTIVE_REFRESH_WINDOW_MS) return false;
  return (
    stage.delivery.queued > 0 ||
    stage.delivery.deferred > 0 ||
    (deliveryEventsConfigured && stage.delivery.accepted > 0)
  );
}

export function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function eventOptions(
  events: readonly EventOption[],
  emptyLabel?: string,
): AppSelectOption[] {
  return [
    ...(emptyLabel ? [{ value: "", label: emptyLabel }] : []),
    ...events.map((event) => ({
      value: event.slug,
      label: `${event.title} · ${shortDate(event.startsAt)}`,
    })),
  ];
}

export function previewValuesForEvent(
  event: EventOption | undefined,
  fallbackTitle?: string,
): CommunicationPreviewValues {
  const date = event?.startsAt
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "full",
        timeZone: "Europe/London",
      }).format(new Date(event.startsAt))
    : undefined;
  return {
    "event.title": event?.title ?? fallbackTitle ?? "your event",
    ...(date ? { "event.date": date } : {}),
  };
}

export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  type = "button",
  ariaExpanded,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaExpanded?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      className={`min-h-11 rounded border px-4 font-mono text-xs transition-opacity hover:opacity-70 disabled:cursor-wait disabled:opacity-45 ${primary ? "border-transparent bg-foreground text-background" : "theme-border-strong text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function EventPlanView(props: {
  events: EventOption[];
  selectedEvent: string;
  setSelectedEvent: (value: string) => void;
  activePlan?: Plan;
  preparePlan: () => void;
  planAction: (action: "schedule-plan" | "pause-plan") => void;
  busy: boolean;
  editingStage: string | null;
  stageDraft: StageDraft;
  setStageDraft: React.Dispatch<React.SetStateAction<StageDraft>>;
  openStage: (stage: Stage) => void;
  saveStage: () => void;
  resetStageTemplate: (stage: Stage) => void;
  setEditingStage: React.Dispatch<React.SetStateAction<string | null>>;
  stageRecipients: {
    stageId: string;
    count: number;
    recipients: Array<{ name: string | null; email: string }>;
  } | null;
  stageDeliveries: { stageId: string; deliveries: StageDelivery[] } | null;
  viewStageRecipients: (stage: Stage) => void;
  previewStageEmail: (stage: Stage) => void;
  stagePreview: { stageId: string; html: string } | null;
  setStagePreview: (value: { stageId: string; html: string } | null) => void;
  testEmail: string;
  setTestEmail: (value: string) => void;
  sendTestPlan: () => void;
  sendStageNow: (stage: Stage) => void;
  sendStageToMissingRecipients: (stage: Stage) => void;
  deliveryRefreshMode: "settling" | "monitoring";
  deliveryRefreshFailed: boolean;
  deliveryAutoRefreshHalted: boolean;
  deliveryCheckedAt: string | null;
  deliveryEventsConfigured: boolean;
}) {
  const {
    events,
    selectedEvent,
    setSelectedEvent,
    activePlan,
    preparePlan,
    planAction,
    busy,
    editingStage,
    stageDraft,
    setStageDraft,
    openStage,
    saveStage,
    resetStageTemplate,
    setEditingStage,
    stageRecipients,
    stageDeliveries,
    viewStageRecipients,
    previewStageEmail,
    stagePreview,
    setStagePreview,
    testEmail,
    setTestEmail,
    sendTestPlan,
    sendStageNow,
    sendStageToMissingRecipients,
    deliveryRefreshMode,
    deliveryRefreshFailed,
    deliveryAutoRefreshHalted,
    deliveryCheckedAt,
    deliveryEventsConfigured,
  } = props;
  const pausedFutureStages =
    activePlan?.stages.filter(
      (stage) => stage.status === "paused" && stage.sendAt && Date.parse(stage.sendAt) > Date.now(),
    ).length ?? 0;
  return (
    <section aria-labelledby="event-plan-heading" className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            event timeline
          </p>
          <h3 id="event-plan-heading" className="mt-2 font-serif text-3xl tracking-tight">
            What is going out, and when?
          </h3>
          <p className="mt-3 max-w-xl font-serif text-lg leading-relaxed theme-muted">
            Prepare the whole event once. Recipients are checked at fan-out time, so late ticket
            buyers get useful future messages without receiving stale ones.
          </p>
        </div>
        <label className="block min-w-[17rem]">
          <span className="font-mono text-micro theme-muted">event</span>
          <AppSelect
            value={selectedEvent}
            onValueChange={setSelectedEvent}
            options={eventOptions(events)}
            ariaLabel="event"
            variant="field"
            className="mt-2"
          />
        </label>
      </div>
      {!activePlan ? (
        <div className="border-y theme-border py-7">
          <p className="font-serif text-2xl">No plan yet.</p>
          <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
            Create the starter sequence for this event. It will save drafts and a feedback survey.
            It will not send anything.
          </p>
          <div className="mt-5">
            <Button primary onClick={preparePlan} disabled={busy || !selectedEvent}>
              prepare event plan
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-y theme-border py-5">
            <div>
              <p className="font-serif text-2xl">{activePlan.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
                <AdminStatus tone={adminToneForStatus(activePlan.status)}>
                  {activePlan.status}
                </AdminStatus>
                <span className="theme-muted">
                  five thoughtful stages · no duplicate ticket confirmation
                </span>
                {pausedFutureStages ? (
                  <AdminStatus tone="attention">
                    {pausedFutureStages} future stage{pausedFutureStages === 1 ? "" : "s"} paused
                  </AdminStatus>
                ) : null}
              </div>
              <div className="mt-2" role="status">
                <AdminStatus
                  tone={
                    deliveryAutoRefreshHalted
                      ? "danger"
                      : deliveryRefreshFailed
                        ? "danger"
                        : deliveryRefreshMode === "settling"
                          ? "attention"
                          : "neutral"
                  }
                  className="font-mono text-micro"
                >
                  {deliveryAutoRefreshHalted
                    ? "automatic delivery updates paused after an access error · use refresh"
                    : deliveryRefreshFailed
                      ? `last delivery check failed · retrying automatically${deliveryCheckedAt ? ` · last successful check ${dateLabel(deliveryCheckedAt)}` : ""}`
                      : deliveryRefreshMode === "settling"
                        ? `delivery data checked ${dateLabel(deliveryCheckedAt)} · updates every 12 seconds while messages settle`
                        : `delivery data checked ${dateLabel(deliveryCheckedAt)} · updates every 30 seconds while this tab is open`}
                </AdminStatus>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {pausedFutureStages ? (
                <Button primary onClick={() => void planAction("schedule-plan")} disabled={busy}>
                  resume future stages
                </Button>
              ) : null}
              {activePlan.status === "scheduled" ? (
                <Button onClick={() => void planAction("pause-plan")} disabled={busy}>
                  pause plan
                </Button>
              ) : (
                <Button primary onClick={() => void planAction("schedule-plan")} disabled={busy}>
                  schedule plan
                </Button>
              )}
            </div>
          </div>
          <div className="admin-form-row grid gap-3 border-b theme-border py-4 sm:grid-cols-[minmax(18rem,1fr)_auto]">
            <div className="admin-form-field">
              <label>
                <span className="font-mono text-micro theme-muted">test recipient</span>
                <input
                  value={testEmail}
                  onChange={(event) => setTestEmail(event.target.value)}
                  type="email"
                  className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
                />
                <span className="mt-2 block font-mono text-micro theme-faint">
                  Sends every stage with a [TEST] subject. It does not schedule the plan.
                </span>
              </label>
              <EmailAddressNotice email={testEmail} onAcceptSuggestion={setTestEmail} />
            </div>
            <AdminFormAction spacing="comfortable">
              <Button onClick={sendTestPlan} disabled={busy || !testEmail.trim()}>
                send all test emails
              </Button>
            </AdminFormAction>
          </div>
          <ol className="mt-5 border-l theme-border pl-6">
            {activePlan.stages.map((stage) => {
              const lifecycle = communicationStageLifecyclePresentation(
                stage,
                stageNeedsManualSendDecision(stage),
              );
              return (
                <li
                  key={stage.id}
                  className="relative border-b theme-border-faint pb-7 pt-2 last:border-0"
                >
                  <span
                    className="absolute -left-[1.78rem] top-3 h-3 w-3 rounded-full border-2 border-background bg-[var(--prose-hashtag)]"
                    aria-hidden="true"
                  />
                  <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div>
                      <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                        {stage.label}
                      </p>
                      <h4 className="mt-2 font-serif text-2xl">{stage.subject}</h4>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
                        <span className="theme-muted">
                          {stage.sendAt ? dateLabel(stage.sendAt) : "needs a send time"}
                        </span>
                        <AdminStatus tone={lifecycle.tone}>{lifecycle.label}</AdminStatus>
                      </div>
                      <CommunicationStageHealth
                        stage={stage}
                        deliveryEventsConfigured={deliveryEventsConfigured}
                      />
                      {stageNeedsManualSendDecision(stage) ? (
                        <p className="mt-2 font-mono text-micro theme-faint">
                          This did not send automatically. Send it now, or edit the time first.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                      <Button
                        onClick={() => void viewStageRecipients(stage)}
                        ariaExpanded={
                          stageRecipients?.stageId === stage.id ||
                          stageDeliveries?.stageId === stage.id
                        }
                      >
                        {stageRecipients?.stageId === stage.id ||
                        stageDeliveries?.stageId === stage.id
                          ? "hide recipients"
                          : stage.delivery.queued +
                                stage.delivery.accepted +
                                stage.delivery.delivered +
                                stage.delivery.failed +
                                stage.delivery.bounced +
                                stage.delivery.rejected +
                                stage.delivery.complained +
                                stage.delivery.skipped >
                              0
                            ? "delivery details"
                            : "see recipients"}
                      </Button>
                      <Button
                        onClick={() => {
                          if (stagePreview?.stageId === stage.id) setStagePreview(null);
                          else void previewStageEmail(stage);
                        }}
                        disabled={busy}
                        ariaExpanded={stagePreview?.stageId === stage.id}
                      >
                        {stagePreview?.stageId === stage.id ? "hide preview" : "preview email"}
                      </Button>
                      {stageCanEdit(stage) ? (
                        <Button
                          onClick={() =>
                            editingStage === stage.id ? setEditingStage(null) : openStage(stage)
                          }
                          ariaExpanded={editingStage === stage.id}
                        >
                          {editingStage === stage.id ? "close editor" : "edit message"}
                        </Button>
                      ) : null}
                      {canSendStageNow(stage) ? (
                        <Button
                          primary={stageNeedsManualSendDecision(stage)}
                          onClick={() => sendStageNow(stage)}
                          disabled={busy}
                        >
                          {stageHasReachedSendTime(stage) ? "send now" : "send early"}
                        </Button>
                      ) : stage.missingRecipientCount > 0 ? (
                        <Button
                          primary
                          onClick={() => void sendStageToMissingRecipients(stage)}
                          disabled={busy}
                        >
                          send to {stage.missingRecipientCount} missing
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {stageRecipients?.stageId === stage.id ? (
                    <div className="mt-4 border-y theme-border-faint py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-xs">
                          {stageRecipients.count} people would receive this
                        </p>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {stageRecipients.recipients.slice(0, 20).map((recipient) => (
                          <p
                            key={recipient.email}
                            className="truncate font-mono text-micro theme-muted"
                          >
                            {recipient.name || "unnamed"} · {recipient.email}
                          </p>
                        ))}
                      </div>
                      {stageRecipients.count > 20 ? (
                        <p className="mt-2 font-mono text-micro theme-faint">
                          showing the first 20
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {stageDeliveries?.stageId === stage.id ? (
                    <div className="mt-4 border-y theme-border-faint py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-xs">
                          {
                            stageDeliveries.deliveries.filter(
                              (delivery) => delivery.isCurrentRecipient,
                            ).length
                          }{" "}
                          current ·{" "}
                          {
                            stageDeliveries.deliveries.filter(
                              (delivery) => !delivery.isCurrentRecipient,
                            ).length
                          }{" "}
                          historical
                        </p>
                        <p className="font-mono text-micro theme-faint">
                          historical attempts are retained for audit, not treated as live problems
                        </p>
                      </div>
                      <div className="mt-3 divide-y theme-border-faint">
                        {stageDeliveries.deliveries.map((delivery) => (
                          <div
                            key={delivery.emailHash}
                            className="grid gap-1 py-3 font-mono text-micro sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
                          >
                            <div className="min-w-0">
                              <p className="truncate">
                                {delivery.displayName || "unnamed"} · {delivery.email}
                              </p>
                              {delivery.lastError ? (
                                <p
                                  className={`mt-1 break-words ${
                                    delivery.isCurrentRecipient
                                      ? adminToneTextClass("danger")
                                      : "theme-muted"
                                  }`}
                                >
                                  {delivery.isCurrentRecipient ? "error" : "historical result"} ·{" "}
                                  {delivery.lastError}
                                </p>
                              ) : null}
                            </div>
                            <AdminStatus
                              tone={deliveryStatusTone(delivery)}
                              className="sm:justify-end sm:text-right"
                            >
                              {deliveryStatusLabel(delivery)}
                              {delivery.attempts
                                ? ` · ${delivery.attempts} attempt${delivery.attempts === 1 ? "" : "s"}`
                                : ""}
                              {delivery.nextAttemptAt &&
                              (delivery.deliveryStatus === "deferred" ||
                                delivery.outboxStatus === "pending")
                                ? ` · next retry ${dateLabel(delivery.nextAttemptAt)}`
                                : ""}
                            </AdminStatus>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {stagePreview?.stageId === stage.id ? (
                    <div className="mt-4 border-y theme-border-faint py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-xs">email preview</p>
                      </div>
                      <iframe
                        title={`${stage.subject} email preview`}
                        sandbox=""
                        srcDoc={stagePreview.html}
                        className="mt-4 h-[38rem] w-full rounded border theme-border bg-background"
                      />
                    </div>
                  ) : null}
                  {editingStage === stage.id ? (
                    <div className="mt-6 space-y-4 border-t theme-border pt-5">
                      <Field
                        label="subject"
                        value={stageDraft.subject}
                        onChange={(value) =>
                          setStageDraft((draft) => ({ ...draft, subject: value }))
                        }
                      />
                      <CommunicationMessageEditor
                        body={stageDraft.body}
                        onBodyChange={(value) =>
                          setStageDraft((draft) => ({ ...draft, body: value }))
                        }
                        media={{
                          kind: stageDraft.mediaKind,
                          url: stageDraft.mediaUrl,
                          alt: stageDraft.mediaAlt,
                          posterUrl: stageDraft.posterUrl,
                        }}
                        onMediaChange={(media) =>
                          setStageDraft((draft) => ({
                            ...draft,
                            mediaKind: media.kind,
                            mediaUrl: media.url,
                            mediaAlt: media.alt,
                            posterUrl: media.posterUrl,
                          }))
                        }
                        previewValues={previewValuesForEvent(
                          events.find((event) => event.slug === selectedEvent),
                          activePlan?.eventTitle,
                        )}
                        hint="Use the writing tools for Markdown. Event tokens such as {{event.venue}} and {{survey.url}} are filled when the email is sent."
                      />
                      <Field
                        label="send at (UTC)"
                        type="datetime-local"
                        value={stageDraft.sendAt}
                        onChange={(value) =>
                          setStageDraft((draft) => ({ ...draft, sendAt: value }))
                        }
                        hint={
                          stageNeedsManualSendDecision(stage)
                            ? "You can change an overdue stage. Saving keeps it unsent until you choose send now."
                            : undefined
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button primary onClick={saveStage} disabled={busy}>
                          save stage
                        </Button>
                        <Button onClick={() => void resetStageTemplate(stage)} disabled={busy}>
                          reset from template
                        </Button>
                        <Button onClick={() => setEditingStage(null)}>close</Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

export function ComposeView(props: {
  events: EventOption[];
  kind: Kind;
  setKind: (value: Kind) => void;
  audience: Audience;
  setAudience: (value: Audience) => void;
  audienceOptions: Array<[Audience, string]>;
  composeEvent: string;
  setComposeEvent: (value: string) => void;
  subject: string;
  setSubject: (value: string) => void;
  body: string;
  setBody: (value: string) => void;
  mediaUrl: string;
  setMediaUrl: (value: string) => void;
  mediaKind: MediaKind;
  setMediaKind: (value: MediaKind) => void;
  mediaAlt: string;
  setMediaAlt: (value: string) => void;
  posterUrl: string;
  setPosterUrl: (value: string) => void;
  scheduledAt: string;
  setScheduledAt: (value: string) => void;
  contacts: Contact[];
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  contactQuery: string;
  setContactQuery: (value: string) => void;
  save: (mode: "draft" | "schedule" | "now") => void;
  preview: () => void;
  previewHtml: string;
  busy: boolean;
  messages: Message[];
  previewValues: CommunicationPreviewValues;
}) {
  const {
    events,
    kind,
    setKind,
    audience,
    setAudience,
    audienceOptions,
    composeEvent,
    setComposeEvent,
    subject,
    setSubject,
    body,
    setBody,
    mediaUrl,
    setMediaUrl,
    mediaKind,
    setMediaKind,
    mediaAlt,
    setMediaAlt,
    posterUrl,
    setPosterUrl,
    scheduledAt,
    setScheduledAt,
    contacts,
    selected,
    setSelected,
    contactQuery,
    setContactQuery,
    save,
    preview,
    previewHtml,
    busy,
    messages,
    previewValues,
  } = props;
  const toggle = (hash: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  return (
    <section aria-labelledby="compose-heading" className="space-y-8">
      <div>
        <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
          one-off messages
        </p>
        <h3 id="compose-heading" className="mt-2 font-serif text-3xl tracking-tight">
          Write, preview, schedule
        </h3>
        <p className="mt-3 max-w-2xl font-serif text-lg leading-relaxed theme-muted">
          Use this for a single note or a message outside an event plan. Save a template when you
          want to use the shape again.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono text-micro theme-muted">message type</span>
          <AppSelect
            value={kind}
            onValueChange={(value) => setKind(value as Kind)}
            options={KIND_OPTIONS}
            ariaLabel="message type"
            variant="field"
            className="mt-2"
          />
        </label>
        <label className="block">
          <span className="font-mono text-micro theme-muted">audience</span>
          <AppSelect
            value={audience}
            onValueChange={(value) => setAudience(value as Audience)}
            options={audienceOptions.map(([value, label]) => ({ value, label }))}
            ariaLabel="audience"
            variant="field"
            className="mt-2"
          />
        </label>
      </div>
      {["event_update", "event_service", "feedback"].includes(kind) ? (
        <label className="block">
          <span className="font-mono text-micro theme-muted">event</span>
          <AppSelect
            value={composeEvent}
            onValueChange={setComposeEvent}
            options={eventOptions(events, "choose an event")}
            ariaLabel="event"
            variant="field"
            className="mt-2"
          />
        </label>
      ) : null}
      {audience === "selected" ? (
        <div>
          <Field
            label="find people"
            value={contactQuery}
            onChange={setContactQuery}
            hint={`${selected.size} selected`}
          />
          <div className="mt-3 max-h-56 overflow-auto border-y theme-border">
            {contacts.map((contact) => (
              <label
                key={contact.emailHash}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-b theme-border-faint py-2 last:border-0"
              >
                <input
                  type="checkbox"
                  checked={selected.has(contact.emailHash)}
                  onChange={() => toggle(contact.emailHash)}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {contact.displayName || "unnamed"}
                </span>
                <span className="truncate font-mono text-micro theme-faint">{contact.email}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <div className="space-y-5">
        <Field label="subject" value={subject} onChange={setSubject} />
        <CommunicationMessageEditor
          body={body}
          onBodyChange={setBody}
          media={{ kind: mediaKind, url: mediaUrl, alt: mediaAlt, posterUrl }}
          onMediaChange={(media) => {
            setMediaKind(media.kind);
            setMediaUrl(media.url);
            setMediaAlt(media.alt);
            setPosterUrl(media.posterUrl);
          }}
          previewValues={previewValues}
          hint="Use the writing tools for Markdown. Event tokens such as {{event.title}} are filled when the email is sent."
        />
        <div className="admin-form-row grid gap-3 sm:grid-cols-[minmax(15rem,1fr)_auto]">
          <Field
            label="send at (UTC)"
            type="datetime-local"
            value={scheduledAt}
            onChange={setScheduledAt}
            hint="The outbox queues recipients in bounded batches."
          />
          <AdminFormAction className="flex flex-wrap gap-3" spacing="comfortable">
            <Button
              onClick={() => void preview()}
              disabled={busy || !subject.trim() || !body.trim()}
            >
              {previewHtml ? "hide email preview" : "preview email"}
            </Button>
            <Button
              onClick={() => void save("draft")}
              disabled={busy || !subject.trim() || !body.trim()}
            >
              save draft
            </Button>
            <Button
              primary
              onClick={() => void save("schedule")}
              disabled={busy || !subject.trim() || !body.trim() || !scheduledAt}
            >
              schedule
            </Button>
            <Button
              onClick={() => void save("now")}
              disabled={busy || !subject.trim() || !body.trim()}
            >
              send now
            </Button>
          </AdminFormAction>
        </div>
      </div>
      {previewHtml ? (
        <div className="border-y theme-border py-5">
          <p className="font-mono text-xs font-bold">email preview</p>
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={previewHtml}
            className="mt-4 h-[38rem] w-full rounded border theme-border bg-background"
          />
        </div>
      ) : null}
      <div className="border-t theme-border pt-7">
        <p className="font-mono text-sm font-bold">planned and recent</p>
        <div className="mt-3 divide-y theme-border">
          {messages.length ? (
            messages.map((message) => (
              <article key={message.id} className="py-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="font-serif text-xl">{message.subject}</p>
                    <p className="mt-1 font-mono text-micro theme-muted">
                      {KIND_LABELS[message.kind]} · {message.recipientCount} people
                    </p>
                    <div className="mt-2 font-mono text-micro">
                      <MessageDeliveryMetrics
                        delivery={message.delivery}
                        links={message.linkClicks}
                      />
                      {communicationLinkMetricsLabel(message.linkClicks) ? (
                        <span className="mt-1 block theme-muted">
                          {communicationLinkMetricsLabel(message.linkClicks)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <AdminStatus
                    tone={adminToneForStatus(message.status)}
                    className="font-mono text-xs"
                  >
                    {message.status}
                  </AdminStatus>
                </div>
                <p className="mt-2 font-mono text-xs theme-faint">
                  {dateLabel(message.scheduledAt)}
                </p>
              </article>
            ))
          ) : (
            <p className="py-4 font-mono text-xs theme-muted">No one-off messages yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function TemplatesView(props: {
  templates: Template[];
  draft: TemplateDraft;
  setDraft: React.Dispatch<React.SetStateAction<TemplateDraft>>;
  save: (event: FormEvent) => Promise<void>;
  archive: (template: Template) => void;
  useTemplate: (template: Template) => void;
  busy: boolean;
}) {
  const { templates, draft, setDraft, save, archive, useTemplate, busy } = props;
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const set = (key: keyof TemplateDraft, value: string | boolean) => {
    setSavedAt(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const beginDraft = (next: TemplateDraft) => {
    setSavedAt(null);
    setDraft(next);
  };
  const handleSave = async (event: FormEvent) => {
    await save(event);
    setSavedAt(Date.now());
  };
  const clearDraft = () =>
    beginDraft({
      id: "",
      name: "",
      kind: "event_service",
      subject: "",
      body: "",
      mediaUrl: "",
      mediaKind: "image",
      mediaAlt: "",
      posterUrl: "",
      isDefault: false,
    });
  return (
    <section aria-labelledby="templates-heading" className="space-y-8">
      <div>
        <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
          reusable shapes
        </p>
        <h3 id="templates-heading" className="mt-2 font-serif text-3xl tracking-tight">
          Templates you can trust
        </h3>
        <p className="mt-3 max-w-2xl font-serif text-lg leading-relaxed theme-muted">
          Templates are editable, duplicable by saving a new name, and safe: event plans use a
          snapshot, so later edits cannot change an email that is already scheduled.
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="border-y theme-border">
          <div className="border-b theme-border-faint px-1 py-3 font-mono text-xs theme-muted">
            {templates.length} templates
          </div>
          {templates.map((template) => (
            <article key={template.id} className="border-b theme-border-faint py-4 last:border-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-xl">{template.name}</p>
                  <p className="mt-1 font-mono text-micro theme-muted">
                    {KIND_LABELS[template.kind]}
                    {template.isDefault ? " · default" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => archive(template)}
                  className="font-mono text-micro theme-muted underline underline-offset-4 hover:opacity-70"
                >
                  archive
                </button>
              </div>
              <div className="mt-3 flex gap-3">
                <Button onClick={() => useTemplate(template)}>use</Button>
                <Button
                  onClick={() =>
                    beginDraft({
                      id: template.id,
                      expectedUpdatedAt: template.updatedAt,
                      name: template.name,
                      kind: template.kind,
                      subject: template.subject,
                      body: template.body,
                      mediaUrl: template.media[0]?.url || "",
                      mediaKind: template.media[0]?.kind || "image",
                      mediaAlt: template.media[0]?.alt || "",
                      posterUrl: template.media[0]?.posterUrl || "",
                      isDefault: template.isDefault,
                    })
                  }
                >
                  edit
                </Button>
                <Button
                  onClick={() =>
                    beginDraft({
                      id: "",
                      name: `${template.name} copy`,
                      kind: template.kind,
                      subject: template.subject,
                      body: template.body,
                      mediaUrl: template.media[0]?.url || "",
                      mediaKind: template.media[0]?.kind || "image",
                      mediaAlt: template.media[0]?.alt || "",
                      posterUrl: template.media[0]?.posterUrl || "",
                      isDefault: false,
                    })
                  }
                >
                  duplicate
                </Button>
              </div>
            </article>
          ))}
        </div>
        <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-sm font-bold">
              {draft.id ? "edit template" : "new template"}
            </p>
            {draft.id || draft.name || draft.body ? (
              <Button onClick={clearDraft}>new template</Button>
            ) : null}
          </div>
          {savedAt ? (
            <div role="status">
              <AdminStatus tone="positive" className="font-mono text-xs">
                saved · ready to use in compose or a future event plan
              </AdminStatus>
            </div>
          ) : null}
          <Field
            label="template name"
            value={draft.name}
            onChange={(value) => set("name", value)}
            hint="For example: after school club · getting there"
          />
          <label className="block">
            <span className="font-mono text-micro theme-muted">type</span>
            <AppSelect
              value={draft.kind}
              onValueChange={(value) => set("kind", value)}
              options={KIND_OPTIONS}
              ariaLabel="type"
              variant="field"
              className="mt-2"
            />
          </label>
          <Field
            label="subject"
            value={draft.subject}
            onChange={(value) => set("subject", value)}
          />
          <CommunicationMessageEditor
            body={draft.body}
            onBodyChange={(value) => set("body", value)}
            media={{
              kind: draft.mediaKind,
              url: draft.mediaUrl,
              alt: draft.mediaAlt,
              posterUrl: draft.posterUrl,
            }}
            onMediaChange={(media) => {
              setDraft((current) => ({
                ...current,
                mediaKind: media.kind,
                mediaUrl: media.url,
                mediaAlt: media.alt,
                posterUrl: media.posterUrl,
              }));
              setSavedAt(null);
            }}
          />
          <label className="flex items-center gap-3 font-mono text-xs">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) => set("isDefault", event.target.checked)}
            />
            use as the default for this type
          </label>
          <Button primary type="submit" disabled={busy}>
            {draft.id ? "update template" : "save template"}
          </Button>
        </form>
      </div>
    </section>
  );
}

export function FeedbackView(props: {
  surveys: Survey[];
  events: EventOption[];
  draft: SurveyDraft;
  setDraft: React.Dispatch<React.SetStateAction<SurveyDraft>>;
  save: (event: FormEvent) => void;
  newSurvey: () => void;
  loadResponses: (survey: Survey) => void;
  selectedSurvey: string | null;
  responses: SurveyResponse[];
  invitations: SurveyInvitation[];
  busy: boolean;
}) {
  const {
    surveys,
    events,
    draft,
    setDraft,
    save,
    newSurvey,
    loadResponses,
    selectedSurvey,
    responses,
    invitations,
    busy,
  } = props;
  const updateQuestion = (index: number, patch: Partial<SurveyQuestion>) =>
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    }));
  return (
    <section aria-labelledby="feedback-heading" className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            feedback studio
          </p>
          <h3 id="feedback-heading" className="mt-2 font-serif text-3xl tracking-tight">
            Questions worth answering
          </h3>
          <p className="mt-3 max-w-2xl font-serif text-lg leading-relaxed theme-muted">
            Create an event survey or a standalone question set. Responses stay here, grouped by
            survey, until you choose to open them.
          </p>
        </div>
        <Button onClick={newSurvey}>new survey</Button>
      </div>
      <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]">
        <div className="border-y theme-border">
          {surveys.length ? (
            surveys.map((survey) => (
              <article
                key={survey.id}
                className={`border-b theme-border-faint py-4 last:border-0 ${selectedSurvey === survey.id ? "bg-[var(--selection-bg)]" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => loadResponses(survey)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-xl">{survey.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-micro">
                        <span className="theme-muted">{survey.responseCount} responses</span>
                        {survey.invitations.issued > 0 ? (
                          <span className="theme-muted">
                            {survey.invitations.completed}/{survey.invitations.issued} invites
                            complete
                          </span>
                        ) : null}
                        <AdminStatus tone={adminToneForStatus(survey.status)}>
                          {survey.status}
                        </AdminStatus>
                      </div>
                    </div>
                    <span className="font-mono text-micro theme-muted">view →</span>
                  </div>
                </button>
              </article>
            ))
          ) : (
            <p className="py-5 font-mono text-xs theme-muted">
              No surveys yet. Prepare an event plan to create its feedback survey.
            </p>
          )}
        </div>
        <div className="space-y-5">
          {selectedSurvey ? (
            <ResponseList
              survey={surveys.find((survey) => survey.id === selectedSurvey)}
              responses={responses}
              invitations={invitations}
            />
          ) : null}
          <form onSubmit={save} className="space-y-4 border-t theme-border pt-6">
            <p className="font-mono text-sm font-bold">{draft.id ? "edit survey" : "new survey"}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="title"
                value={draft.title}
                onChange={(value) => setDraft((current) => ({ ...current, title: value }))}
              />
              <Field
                label="slug"
                value={draft.slug}
                onChange={(value) => setDraft((current) => ({ ...current, slug: value }))}
                hint="This becomes /surveys/your-slug"
              />
            </div>
            <Field
              label="intro"
              value={draft.intro}
              onChange={(value) => setDraft((current) => ({ ...current, intro: value }))}
              rows={4}
            />
            <label className="block">
              <span className="font-mono text-micro theme-muted">event (optional)</span>
              <AppSelect
                value={draft.eventSlug}
                onValueChange={(value) => setDraft((current) => ({ ...current, eventSlug: value }))}
                options={eventOptions(events, "standalone survey")}
                ariaLabel="event (optional)"
                variant="field"
                className="mt-2"
              />
            </label>
            <label className="block">
              <span className="font-mono text-micro theme-muted">response identity</span>
              <AppSelect
                value={draft.identityMode}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    identityMode: value as Survey["identityMode"],
                  }))
                }
                options={SURVEY_IDENTITY_OPTIONS}
                ariaLabel="response identity"
                variant="field"
                className="mt-2"
              />
              <span className="mt-2 block font-mono text-micro leading-relaxed theme-faint">
                Personal links are created only when this survey is sent by email. Anonymous
                completions are counted without linking the person to their answers.
              </span>
            </label>
            <label className="block">
              <span className="font-mono text-micro theme-muted">status</span>
              <AppSelect
                value={draft.status}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    status: value as Survey["status"],
                  }))
                }
                options={SURVEY_STATUS_OPTIONS}
                ariaLabel="status"
                variant="field"
                className="mt-2"
              />
            </label>
            <div className="space-y-4 border-t theme-border-faint pt-5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-bold">questions</p>
                <Button
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      questions: [
                        ...current.questions,
                        {
                          id: `question-${current.questions.length + 1}`,
                          type: "long_text",
                          label: "",
                          required: false,
                        },
                      ],
                    }))
                  }
                >
                  add question
                </Button>
              </div>
              {draft.questions.map((question, index) => (
                <div key={question.id} className="space-y-3 border-b theme-border-faint pb-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-micro theme-muted">question {index + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          questions: current.questions.filter(
                            (_, questionIndex) => questionIndex !== index,
                          ),
                        }))
                      }
                      className="font-mono text-micro theme-muted underline underline-offset-4"
                    >
                      remove
                    </button>
                  </div>
                  <Field
                    label="prompt"
                    value={question.label}
                    onChange={(value) => updateQuestion(index, { label: value })}
                  />
                  <label className="block">
                    <span className="font-mono text-micro theme-muted">answer shape</span>
                    <AppSelect
                      value={question.type}
                      onValueChange={(value) =>
                        updateQuestion(index, {
                          type: value as SurveyQuestion["type"],
                        })
                      }
                      options={QUESTION_TYPE_OPTIONS}
                      ariaLabel="answer shape"
                      variant="field"
                      className="mt-2"
                    />
                  </label>
                  {["single_choice", "multi_choice"].includes(question.type) ? (
                    <Field
                      label="choices"
                      value={(question.options || []).join("\n")}
                      onChange={(value) =>
                        updateQuestion(index, {
                          options: value
                            .split("\n")
                            .map((option) => option.trim())
                            .filter(Boolean),
                        })
                      }
                      hint="One choice per line."
                    />
                  ) : null}
                  <label className="flex items-center gap-3 font-mono text-xs">
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={(event) =>
                        updateQuestion(index, { required: event.target.checked })
                      }
                    />
                    required
                  </label>
                </div>
              ))}
            </div>
            <Button
              primary
              type="submit"
              disabled={busy || !draft.title || draft.questions.length === 0}
            >
              save survey
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}

export function ResponseList({
  survey,
  responses,
  invitations,
}: {
  survey?: Survey;
  responses: SurveyResponse[];
  invitations: SurveyInvitation[];
}) {
  if (!survey) return null;
  return (
    <div className="border-y theme-border py-5">
      <div>
        <p className="font-mono text-xs font-bold">responses</p>
        <p className="mt-1 font-mono text-micro theme-muted">{responses.length} loaded</p>
        {survey.invitations.issued > 0 ? (
          <p className="mt-1 font-mono text-micro theme-muted">
            {survey.invitations.issued} invited · {survey.invitations.opened} opened ·{" "}
            {survey.invitations.completed} completed
          </p>
        ) : null}
      </div>
      <div className="mt-5 space-y-5">
        {responses.length ? (
          responses.map((response) => (
            <article key={response.id} className="border-t theme-border-faint pt-4">
              <p className="font-mono text-micro theme-muted">
                {response.respondentName || "anonymous"}
                {response.respondentEmail ? ` · ${response.respondentEmail}` : ""} ·{" "}
                {response.identitySource} · {dateLabel(response.submittedAt)}
              </p>
              <dl className="mt-3 space-y-3">
                {survey.questions.map((question) => {
                  const answer = response.answers[question.id];
                  return answer === undefined ? null : (
                    <div key={question.id}>
                      <dt className="font-serif text-base font-semibold">{question.label}</dt>
                      <dd className="mt-1 whitespace-pre-wrap font-serif text-base leading-relaxed theme-muted">
                        {Array.isArray(answer) ? answer.join(", ") : answer}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          ))
        ) : (
          <p className="font-mono text-xs theme-muted">No responses yet.</p>
        )}
      </div>
      {invitations.length ? (
        <div className="mt-6 border-t theme-border pt-5">
          <p className="font-mono text-xs font-bold">invitation lifecycle</p>
          <div className="mt-3 space-y-2">
            {invitations.map((invitation) => (
              <p key={invitation.id} className="font-mono text-micro theme-muted">
                {invitation.respondentName || invitation.respondentEmail} ·{" "}
                {invitation.completedAt
                  ? `completed ${invitation.completionMode}`
                  : invitation.openedAt
                    ? "opened"
                    : "sent"}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PeopleView({
  contacts,
  setPreference,
}: {
  contacts: Contact[];
  setPreference: (contact: Contact, optedIn: boolean) => void;
}) {
  return (
    <section aria-labelledby="people-heading" className="space-y-7">
      <div>
        <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
          audience &amp; consent
        </p>
        <h3 id="people-heading" className="mt-2 font-serif text-3xl tracking-tight">
          Marketing permissions
        </h3>
        <p className="mt-3 max-w-2xl font-serif text-lg leading-relaxed theme-muted">
          Event service messages are separate. This switch controls optional marketing only.
        </p>
      </div>
      <div className="border-y theme-border">
        {contacts.map((contact) => (
          <div
            key={contact.emailHash}
            className="flex flex-wrap items-center gap-4 border-b theme-border-faint py-4 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs">
                {contact.displayName || "unnamed person"} · {contact.email}
              </p>
              <p className="mt-1 font-mono text-micro theme-faint">
                {contact.sources.join(" · ") || "source unknown"}
              </p>
              <AdminStatus
                tone={contact.marketingOptedIn ? "positive" : "neutral"}
                className="mt-1 font-mono text-micro"
              >
                {consentLabel(contact)}
              </AdminStatus>
            </div>
            <button
              type="button"
              onClick={() => setPreference(contact, !contact.marketingOptedIn)}
              className={`min-h-9 rounded border px-3 font-mono text-micro transition-opacity hover:opacity-70 ${contact.marketingOptedIn ? "border-transparent bg-foreground text-background" : "theme-border-strong text-foreground"}`}
            >
              {contact.marketingOptedIn ? "marketing on" : "marketing off"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
