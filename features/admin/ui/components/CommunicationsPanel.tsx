"use client";

import { useAdminDraftState } from "../hooks/useAdminDraftState";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fromZonedDateTimeInput, toZonedDateTimeInput } from "@/lib/shared/zoned-datetime";

import { useActionDialog } from "@/hooks/useActionDialog";
import { useAdminAutoRefresh } from "@/features/admin/ui/hooks/useAdminAutoRefresh";
import { COMMUNICATION_TABS, type CommunicationsTab } from "./AdminSectionNav";
import { EmailOperationsPanel } from "./EmailOperationsPanel";
import { AlertSettings } from "./AlertSettings";
import { AdminStatus } from "./AdminStatus";
import { AdminLoadError, AdminLoading } from "./AdminLoadState";
import { CreditsPanel } from "./CreditsPanel";
import { PollsPanel } from "./PollsPanel";

import {
  AuthFetch,
  Kind,
  Audience,
  MediaKind,
  Contact,
  EventOption,
  Message,
  EmailCapability,
  Template,
  Stage,
  StageDelivery,
  Plan,
  Survey,
  SurveyResponse,
  SurveyInvitation,
  StageDraft,
  TemplateDraft,
  SurveyDraft,
  dateLabel,
  stageHasRecentUnsettledDelivery,
  previewValuesForEvent,
  Button,
  EventPlanView,
  ComposeView,
  TemplatesView,
  FeedbackView,
  PeopleView,
} from "./CommunicationsViews";
export type InitialCommunications = {
  data: Awaited<
    ReturnType<
      typeof import("@/features/communications/admin-workspace.functions").readCommunicationsWorkspaceFn
    >
  > | null;
  error: string | null;
} | null;

export function CommunicationsPanel({
  initialWorkspace,
  authFetch,
  onError,
  onStatus,
  communicationTab,
  communicationEvent,
  initialEmailStatus,
  initialEmailQuery,
  onCommunicationTabChange,
  onCommunicationEventChange,
  ensureStepUpToken,
  withStepUpHeaders,
}: {
  initialWorkspace?: InitialCommunications;
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  communicationTab: CommunicationsTab;
  communicationEvent?: string;
  initialEmailStatus?: string;
  initialEmailQuery?: string;
  onCommunicationTabChange: (tab: CommunicationsTab) => void;
  onCommunicationEventChange: (eventSlug: string) => void;
  ensureStepUpToken: () => Promise<
    { ok: true; token: string } | { ok: false; cancelled?: true; error?: string }
  >;
  withStepUpHeaders: (token: string, extra?: Record<string, string>) => Record<string, string>;
}) {
  const [contacts, setContacts] = useState<Contact[]>(initialWorkspace?.data?.contacts ?? []);
  const [messages, setMessages] = useState<Message[]>(initialWorkspace?.data?.messages ?? []);
  const [events, setEvents] = useState<EventOption[]>(initialWorkspace?.data?.events ?? []);
  const [plans, setPlans] = useState<Plan[]>(initialWorkspace?.data?.plans ?? []);
  const [templates, setTemplates] = useState<Template[]>(initialWorkspace?.data?.templates ?? []);
  const [surveys, setSurveys] = useState<Survey[]>(initialWorkspace?.data?.surveys ?? []);
  const [email, setEmail] = useState<EmailCapability>({ provider: null, mailpitUrl: null });
  const [localTab, setLocalTab] = useState<CommunicationsTab>(communicationTab);
  const [loading, setLoading] = useState(!initialWorkspace);
  const [hasLoaded, setHasLoaded] = useState(Boolean(initialWorkspace?.data));
  const [loadError, setLoadError] = useState<string | null>(initialWorkspace?.error ?? null);
  const [busy, setBusy] = useState(false);
  const [planRefreshHalted, setPlanRefreshHalted] = useState(false);
  const [planRefreshFailed, setPlanRefreshFailed] = useState(false);
  const [planCheckedAt, setPlanCheckedAt] = useState<string | null>(null);
  const [localSelectedEvent, setLocalSelectedEvent] = useState(
    communicationEvent || initialWorkspace?.data?.selectedEvent || "",
  );
  const [stageEditor, setStageEditor] = useAdminDraftState<{
    id: string | null;
    draft: StageDraft;
  }>(
    "communications:stage-editor",
    {
      id: null,
      draft: {
        subject: "",
        body: "",
        sendAt: "",
        mediaUrl: "",
        mediaKind: "image",
        mediaAlt: "",
        posterUrl: "",
      },
    },
    (value) => value.id !== null,
  );
  const editingStage = stageEditor.id;
  const stageDraft = stageEditor.draft;
  const setEditingStage: React.Dispatch<React.SetStateAction<string | null>> = (value) =>
    setStageEditor((current) => ({
      ...current,
      id: typeof value === "function" ? value(current.id) : value,
    }));
  const setStageDraft: React.Dispatch<React.SetStateAction<StageDraft>> = (value) =>
    setStageEditor((current) => ({
      ...current,
      draft: typeof value === "function" ? value(current.draft) : value,
    }));
  const [stageRecipients, setStageRecipients] = useState<{
    stageId: string;
    count: number;
    recipients: Array<{ name: string | null; email: string }>;
  } | null>(null);
  const [stageDeliveries, setStageDeliveries] = useState<{
    stageId: string;
    deliveries: StageDelivery[];
  } | null>(null);
  const [stagePreview, setStagePreview] = useState<{ stageId: string; html: string } | null>(null);
  const [testEmail, setTestEmail] = useState("try@owenabel.com");
  const [composition, setComposition] = useAdminDraftState<{
    kind: Kind;
    audience: Audience;
    composeEvent: string;
    subject: string;
    body: string;
    scheduledAt: string;
    mediaUrl: string;
    mediaKind: MediaKind;
    mediaAlt: string;
    posterUrl: string;
    selectedHashes: string[];
  }>(
    "communications:composition",
    {
      kind: "newsletter",
      audience: "marketing_opted_in",
      composeEvent: "",
      subject: "",
      body: "",
      scheduledAt: "",
      mediaUrl: "",
      mediaKind: "image",
      mediaAlt: "",
      posterUrl: "",
      selectedHashes: [],
    },
    (value) =>
      Boolean(value.subject || value.body || value.mediaUrl || value.selectedHashes?.length),
  );
  const {
    kind,
    audience,
    composeEvent,
    subject,
    body,
    scheduledAt,
    mediaUrl,
    mediaKind,
    mediaAlt,
    posterUrl,
  } = composition;
  const setComposeField =
    <K extends keyof typeof composition>(key: K) =>
    (value: (typeof composition)[K]) =>
      setComposition((current) => ({ ...current, [key]: value }));
  const setKind = setComposeField("kind"),
    setAudience = setComposeField("audience"),
    setComposeEvent = setComposeField("composeEvent"),
    setSubject = setComposeField("subject"),
    setBody = setComposeField("body"),
    setScheduledAt = setComposeField("scheduledAt"),
    setMediaUrl = setComposeField("mediaUrl"),
    setMediaKind = setComposeField("mediaKind"),
    setMediaAlt = setComposeField("mediaAlt"),
    setPosterUrl = setComposeField("posterUrl");
  const [previewHtml, setPreviewHtml] = useState("");
  const selected = new Set(composition.selectedHashes ?? []);
  const setSelected: React.Dispatch<React.SetStateAction<Set<string>>> = (update) =>
    setComposition((current) => ({
      ...current,
      selectedHashes: [
        ...(typeof update === "function" ? update(new Set(current.selectedHashes ?? [])) : update),
      ],
    }));
  const [contactQuery, setContactQuery] = useState("");
  const [contactsNextCursor, setContactsNextCursor] = useState<string | null>(
    initialWorkspace?.data?.contactsNextCursor ?? null,
  );
  const [optedInCount, setOptedInCount] = useState(initialWorkspace?.data?.optedInCount ?? 0);
  const [templateDraft, setTemplateDraft] = useAdminDraftState<TemplateDraft>(
    "communications:templateDraft",
    {
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
    },
  );
  const [surveyDraft, setSurveyDraft, markSurveySaved] = useAdminDraftState<SurveyDraft>(
    "communications:surveyDraft",
    {
      id: "",
      slug: "",
      eventSlug: "",
      title: "",
      intro: "",
      identityMode: "identified",
      status: "draft",
      questions: [],
    },
  );
  const [selectedSurvey, setSelectedSurvey] = useState<string | null>(null);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [surveyInvitations, setSurveyInvitations] = useState<SurveyInvitation[]>([]);
  const { confirm, dialog } = useActionDialog();
  const tab = communicationTab || localTab;
  const selectedEvent = communicationEvent || localSelectedEvent;
  const setTab = (nextTab: CommunicationsTab) => {
    setLocalTab(nextTab);
    onCommunicationTabChange(nextTab);
  };
  const setSelectedEvent = useCallback(
    (nextEvent: string) => {
      setLocalSelectedEvent(nextEvent);
      setPlanRefreshHalted(false);
      setPlanRefreshFailed(false);
      onCommunicationEventChange(nextEvent);
    },
    [onCommunicationEventChange],
  );

  const activeLoad = useRef<AbortController | null>(null);
  useEffect(() => () => activeLoad.current?.abort(), []);
  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await authFetch(
        `/api/admin/communications?${new URLSearchParams({ scope: "workspace", tab, eventSlug: selectedEvent, q: contactQuery })}`,
        { signal: controller.signal },
      );
      const data = (await response.json().catch(() => ({}))) as {
        contacts?: Contact[];
        contactsNextCursor?: string | null;
        optedInCount?: number;
        selectedEvent?: string;
        messages?: Message[];
        events?: EventOption[];
        plans?: Plan[];
        templates?: Template[];
        surveys?: Survey[];
        email?: EmailCapability;
        checkedAt?: string;
        error?: string;
      };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || "Could not load communications");
      setContacts(data.contacts || []);
      setContactsNextCursor(data.contactsNextCursor ?? null);
      setOptedInCount(data.optedInCount ?? 0);
      if (!selectedEvent && data.selectedEvent) setLocalSelectedEvent(data.selectedEvent);
      setMessages(data.messages || []);
      setEvents(data.events || []);
      setPlans(data.plans || []);
      setTemplates(data.templates || []);
      setSurveys(data.surveys || []);
      setEmail(data.email || { provider: null, mailpitUrl: null });
      setPlanRefreshHalted(false);
      setPlanRefreshFailed(false);
      setPlanCheckedAt(data.checkedAt || new Date().toISOString());
      setHasLoaded(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Could not load communications";
      setLoadError(message);
      onError(message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [authFetch, onError, tab, selectedEvent, contactQuery]);
  useEffect(() => {
    activeLoad.current?.abort();
    if (initialWorkspace?.data) {
      const data = initialWorkspace.data;
      setContacts(data.contacts);
      setMessages(data.messages);
      setEvents(data.events);
      setPlans(data.plans);
      setTemplates(data.templates);
      setSurveys(data.surveys);
      setEmail(data.email);
      setContactsNextCursor(data.contactsNextCursor);
      setOptedInCount(data.optedInCount);
      setLocalSelectedEvent(data.selectedEvent);
      setHasLoaded(true);
      setLoadError(null);
      setLoading(false);
    } else if (initialWorkspace?.error) {
      setLoadError(initialWorkspace.error);
      setLoading(false);
    }
  }, [initialWorkspace]);
  const previousSearch = useRef("");
  useEffect(() => {
    const searchChanged = previousSearch.current !== contactQuery;
    previousSearch.current = contactQuery;
    if (initialWorkspace && !searchChanged) return;
    const timer = setTimeout(() => void load(), 300);
    return () => {
      clearTimeout(timer);
      activeLoad.current?.abort();
    };
  }, [load, initialWorkspace, contactQuery]);

  const activePlan = plans.find((plan) => plan.eventSlug === selectedEvent);
  const planDeliveryIsActive =
    tab === "event-plan" &&
    Boolean(
      activePlan?.stages.some((stage) =>
        stageHasRecentUnsettledDelivery(stage, email.deliveryEventsConfigured === true),
      ),
    );
  const planRefreshEnabled = tab === "event-plan" && Boolean(selectedEvent);
  const refreshActivePlan = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!selectedEvent) return;
      try {
        const params = new URLSearchParams({ scope: "event-plan", eventSlug: selectedEvent });
        const response = await authFetch(`/api/admin/communications?${params}`);
        const data = (await response.json().catch(() => ({}))) as {
          plans?: Plan[];
          checkedAt?: string;
        };
        if (!response.ok) {
          if (isCurrent()) {
            setPlanRefreshFailed(true);
            if (response.status >= 400 && response.status < 500) setPlanRefreshHalted(true);
          }
          throw new Error("Could not refresh event-plan delivery status");
        }
        if (!isCurrent()) return;
        const refreshed = data.plans || [];
        setPlanRefreshHalted(false);
        setPlanRefreshFailed(false);
        setPlanCheckedAt(data.checkedAt || new Date().toISOString());
        setPlans((current) => [
          ...current.filter((plan) => plan.eventSlug !== selectedEvent),
          ...refreshed,
        ]);
      } catch (error) {
        if (isCurrent()) setPlanRefreshFailed(true);
        throw error;
      }
    },
    [authFetch, selectedEvent],
  );
  useAdminAutoRefresh({
    enabled: planRefreshEnabled && !planRefreshHalted,
    cadence: planDeliveryIsActive ? "active" : "monitoring",
    identity: `admin-event-plan:${selectedEvent}`,
    refresh: refreshActivePlan,
  });
  const scheduledCount =
    messages.filter((message) => message.status === "scheduled").length +
    plans.flatMap((plan) => plan.stages).filter((stage) => stage.status === "scheduled").length;
  const nextSend =
    [
      ...messages
        .filter((message) => message.status === "scheduled" && message.scheduledAt)
        .map((message) => message.scheduledAt as string),
      ...plans.flatMap((plan) =>
        plan.stages
          .filter((stage) => stage.status === "scheduled" && stage.sendAt)
          .map((stage) => stage.sendAt as string),
      ),
    ].sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
  const filteredContacts = useMemo(() => {
    const term = contactQuery.trim().toLowerCase();
    return contacts.filter(
      (contact) =>
        !term ||
        contact.email.toLowerCase().includes(term) ||
        (contact.displayName || "").toLowerCase().includes(term),
    );
  }, [contacts, contactQuery]);

  const post = async (payload: Record<string, unknown>) => {
    const response = await authFetch("/api/admin/communications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      [key: string]: unknown;
    };
    if (!response.ok) throw new Error(data.error || "That action could not be completed");
    return data;
  };
  const preparePlan = async () => {
    setBusy(true);
    try {
      await post({ action: "create-starter-plan", eventSlug: selectedEvent });
      onStatus("The event plan is ready as drafts. Nothing has been sent.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not prepare the event plan");
    } finally {
      setBusy(false);
    }
  };
  const planAction = async (action: "schedule-plan" | "pause-plan") => {
    if (!activePlan) return;
    if (action === "schedule-plan") {
      const hasPausedFutureStages = activePlan.stages.some(
        (stage) =>
          stage.status === "paused" && stage.sendAt && Date.parse(stage.sendAt) > Date.now(),
      );
      const approved = await confirm({
        eyebrow: "event plan",
        title: hasPausedFutureStages ? "Resume the future stages?" : "Schedule the future stages?",
        description: hasPausedFutureStages
          ? "Paused future stages will be restored. Stages already sent stay sent."
          : "Past stages stay unsent until you choose send now or set a new time.",
        confirmLabel: hasPausedFutureStages ? "resume stages" : "schedule plan",
      });
      if (!approved) return;
    }
    setBusy(true);
    try {
      await post({ action, planId: activePlan.id });
      onStatus(action === "schedule-plan" ? "Event plan scheduled." : "Event plan paused.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update event plan");
    } finally {
      setBusy(false);
    }
  };
  const openStage = (stage: Stage) => {
    setEditingStage(stage.id);
    const media = stage.media[0];
    setStageDraft({
      subject: stage.subject,
      body: stage.body,
      sendAt: toZonedDateTimeInput(stage.sendAt, "UTC"),
      originalSendAt: stage.sendAt,
      expectedUpdatedAt: stage.updatedAt,
      mediaUrl: media?.url || "",
      mediaKind: media?.kind || "image",
      mediaAlt: media?.alt || "",
      posterUrl: media?.posterUrl || "",
    });
  };
  const saveStage = async () => {
    if (!editingStage) return;
    setBusy(true);
    try {
      await post({
        action: "update-stage",
        stageId: editingStage,
        expectedUpdatedAt: stageDraft.expectedUpdatedAt,
        subject: stageDraft.subject,
        messageBody: stageDraft.body,
        sendAt:
          stageDraft.sendAt === toZonedDateTimeInput(stageDraft.originalSendAt, "UTC")
            ? stageDraft.originalSendAt
            : (fromZonedDateTimeInput(stageDraft.sendAt, "UTC") ?? null),
        media: stageDraft.mediaUrl
          ? [
              {
                kind: stageDraft.mediaKind,
                url: stageDraft.mediaUrl,
                alt: stageDraft.mediaAlt,
                ...(stageDraft.posterUrl ? { posterUrl: stageDraft.posterUrl } : {}),
              },
            ]
          : [],
      });
      onStatus("Stage saved.");
      setEditingStage(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save stage");
    } finally {
      setBusy(false);
    }
  };
  const resetStageTemplate = async (stage: Stage) => {
    const approved = await confirm({
      eyebrow: "stage editing",
      title: "Restore the template?",
      description: `Your edits to “${stage.label}” will be replaced by its${stage.templateName ? ` ${stage.templateName}` : " source"} template.`,
      confirmLabel: "restore template",
    });
    if (!approved) return;
    setBusy(true);
    try {
      await post({ action: "reset-stage-template", stageId: stage.id });
      setEditingStage(null);
      onStatus("Stage restored from its template.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not restore stage template");
    } finally {
      setBusy(false);
    }
  };
  const previewStage = async (stage: Stage) => {
    try {
      const data = (await post({ action: "preview-stage", stageId: stage.id })) as {
        recipientCount: number;
        recipients: Array<{ name: string | null; email: string }>;
      };
      setStageRecipients({
        stageId: stage.id,
        count: data.recipientCount,
        recipients: data.recipients,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not preview recipients");
    }
  };
  const viewStageRecipients = async (stage: Stage) => {
    if (stageDeliveries?.stageId === stage.id) {
      setStageDeliveries(null);
      return;
    }
    if (stageRecipients?.stageId === stage.id) {
      setStageRecipients(null);
      return;
    }
    try {
      const data = (await post({ action: "stage-deliveries", stageId: stage.id })) as {
        deliveries?: StageDelivery[];
      };
      if (data.deliveries && data.deliveries.length > 0) {
        setStageDeliveries({ stageId: stage.id, deliveries: data.deliveries });
        setStageRecipients(null);
        return;
      }
      await previewStage(stage);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load delivery details");
    }
  };
  const previewStageEmail = async (stage: Stage) => {
    try {
      const data = (await post({ action: "preview-stage-email", stageId: stage.id })) as {
        rendered?: { html: string };
      };
      setStagePreview({ stageId: stage.id, html: data.rendered?.html || "" });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not preview email");
    }
  };
  const sendTestPlan = async () => {
    if (!activePlan) return;
    const recipient = testEmail.trim();
    const approved = await confirm({
      eyebrow: "test delivery",
      title: "Send the whole plan?",
      description: `This sends every stage in the event plan to ${recipient}. It does not contact ticket holders.`,
      confirmLabel: "send test emails",
    });
    if (!approved) return;
    setBusy(true);
    try {
      const data = await post({ action: "send-test-plan", planId: activePlan.id, testEmail });
      onStatus(`${String(data.queued || 0)} test emails queued to ${testEmail.trim()}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not send test emails");
    } finally {
      setBusy(false);
    }
  };
  const sendStageNow = async (stage: Stage) => {
    const approved = await confirm({
      eyebrow: "event communication",
      title: "Send this stage now?",
      description: `“${stage.subject}” will go to the current valid ticket holders. This sends only this stage and does not enable the rest of the plan.`,
      confirmLabel: "send stage",
    });
    if (!approved) return;
    setBusy(true);
    try {
      const data = (await post({ action: "send-stage-now", stageId: stage.id })) as {
        queued?: number;
      };
      onStatus(
        `${data.queued || 0} messages from “${stage.label}” queued. No other stage was changed.`,
      );
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not send stage");
    } finally {
      setBusy(false);
    }
  };
  const sendStageToMissingRecipients = async (stage: Stage) => {
    const approved = await confirm({
      eyebrow: "event communication",
      title: `Send to ${stage.missingRecipientCount} missing attendee${stage.missingRecipientCount === 1 ? "" : "s"}?`,
      description: `“${stage.subject}” will go only to current valid ticket holders who have never been queued for this stage. Anyone with an existing delivery record will not receive it again.`,
      confirmLabel: "send to missing",
    });
    if (!approved) return;
    setBusy(true);
    try {
      const data = (await post({ action: "send-stage-to-missing", stageId: stage.id })) as {
        queued?: number;
      };
      onStatus(
        data.queued
          ? `${data.queued} missing attendee${data.queued === 1 ? "" : "s"} queued for “${stage.label}”.`
          : `Everyone eligible for “${stage.label}” already has a delivery record.`,
      );
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not send to missing attendees");
    } finally {
      setBusy(false);
    }
  };
  const save = async (mode: "draft" | "schedule" | "now") => {
    setBusy(true);
    try {
      const media = mediaUrl.trim()
        ? [
            {
              kind: mediaKind,
              url: mediaUrl.trim(),
              alt: mediaAlt.trim(),
              ...(posterUrl.trim() ? { posterUrl: posterUrl.trim() } : {}),
            },
          ]
        : [];
      const sendAt =
        mode === "draft"
          ? null
          : mode === "now"
            ? new Date().toISOString()
            : fromZonedDateTimeInput(scheduledAt, "UTC");
      await post({
        kind,
        audience,
        eventSlug: composeEvent || null,
        subject,
        body,
        media,
        selectedContactHashes: [...selected],
        scheduledAt: sendAt,
      });
      onStatus(
        mode === "draft"
          ? "Draft saved."
          : mode === "now"
            ? "Message queued to send now."
            : "Message scheduled.",
      );
      setSubject("");
      setBody("");
      setMediaUrl("");
      setMediaAlt("");
      setPosterUrl("");
      setScheduledAt("");
      setSelected(new Set());
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save communication");
    } finally {
      setBusy(false);
    }
  };
  const preview = async () => {
    if (previewHtml) {
      setPreviewHtml("");
      return;
    }
    setBusy(true);
    try {
      const data = (await post({
        action: "preview",
        kind,
        eventSlug: composeEvent || null,
        subject,
        messageBody: body,
        media: mediaUrl
          ? [{ kind: mediaKind, url: mediaUrl, alt: mediaAlt, ...(posterUrl ? { posterUrl } : {}) }]
          : [],
      })) as { rendered?: { html: string } };
      setPreviewHtml(data.rendered?.html || "");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not render preview");
    } finally {
      setBusy(false);
    }
  };
  const useTemplate = (template: Template) => {
    setKind(template.kind);
    setSubject(template.subject);
    setBody(template.body);
    const media = template.media[0];
    setMediaUrl(media?.url || "");
    setMediaKind(media?.kind || "image");
    setMediaAlt(media?.alt || "");
    setPosterUrl(media?.posterUrl || "");
    setTab("compose");
  };
  const saveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await post({
        action: "save-template",
        templateId: templateDraft.id || undefined,
        expectedUpdatedAt: templateDraft.expectedUpdatedAt,
        name: templateDraft.name,
        kind: templateDraft.kind,
        subject: templateDraft.subject,
        messageBody: templateDraft.body,
        media: templateDraft.mediaUrl
          ? [
              {
                kind: templateDraft.mediaKind,
                url: templateDraft.mediaUrl,
                alt: templateDraft.mediaAlt,
                ...(templateDraft.posterUrl ? { posterUrl: templateDraft.posterUrl } : {}),
              },
            ]
          : [],
        isDefault: templateDraft.isDefault,
      });
      onStatus("Template saved.");
      setTemplateDraft({
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
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save template");
    } finally {
      setBusy(false);
    }
  };
  const archiveTemplate = async (template: Template) => {
    const approved = await confirm({
      eyebrow: "template library",
      title: "Archive this template?",
      description: `“${template.name}” will no longer be available as an active template.`,
      confirmLabel: "archive template",
      intent: "danger",
    });
    if (!approved) return;
    try {
      await post({ action: "archive-template", templateId: template.id });
      onStatus("Template archived.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not archive template");
    }
  };
  const saveSurveyDraft = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await authFetch("/api/admin/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(surveyDraft),
      });
      const data = (await response.json().catch(() => ({}))) as { survey?: Survey; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save survey");
      const savedDraft = { ...surveyDraft, id: data.survey?.id ?? surveyDraft.id };
      markSurveySaved(savedDraft);
      setSurveyDraft((current) => ({ ...current, id: savedDraft.id }));
      onStatus("Survey saved.");
      if (data.survey) setSelectedSurvey(data.survey.id);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save survey");
    } finally {
      setBusy(false);
    }
  };
  const loadResponses = async (survey: Survey) => {
    setSelectedSurvey(survey.id);
    setSurveyDraft({
      id: survey.id,
      slug: survey.slug,
      eventSlug: survey.eventSlug || "",
      title: survey.title,
      intro: survey.intro,
      identityMode: survey.identityMode,
      status: survey.status,
      questions: survey.questions,
    });
    try {
      const response = await authFetch(`/api/admin/surveys/${survey.id}`);
      const data = (await response.json().catch(() => ({}))) as {
        responses?: SurveyResponse[];
        invitations?: SurveyInvitation[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load feedback");
      setResponses(data.responses || []);
      setSurveyInvitations(data.invitations || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load feedback");
    }
  };
  const newSurvey = () => {
    setSurveyDraft({
      id: "",
      slug: "",
      eventSlug: "",
      title: "",
      intro: "",
      identityMode: "identified",
      status: "draft",
      questions: [{ id: "question-1", type: "long_text", label: "", required: true }],
    });
    setSelectedSurvey(null);
    setResponses([]);
    setSurveyInvitations([]);
  };
  const audienceOptions: Array<[Audience, string]> =
    kind === "newsletter"
      ? [
          ["marketing_opted_in", "people who opted in"],
          ["selected", "selected people"],
        ]
      : kind === "pitch_nudge"
        ? [
            ["pitch_owners", "unfinished pitch owners"],
            ["selected", "selected people"],
          ]
        : [
            ["event_attendees", "valid ticket holders"],
            ["selected", "selected people"],
          ];

  return (
    <div className="space-y-6">
      <section aria-label="Communications status" className="border-y theme-border py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              communications snapshot
            </p>
            <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
              Ticket service messages stay automatic; optional marketing follows recorded consent.
            </p>
          </div>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? "refreshing…" : "refresh"}
          </Button>
        </div>
        {loadError ? (
          <div className="mt-4">
            <AdminLoadError message={loadError} retry={() => void load()} retrying={loading} />
          </div>
        ) : loading && !hasLoaded ? (
          <div className="mt-4">
            <AdminLoading label="Loading communications…" />
          </div>
        ) : (
          <>
            <dl className="mt-4 grid gap-4 border-t theme-border pt-4 font-mono text-xs sm:grid-cols-4">
              {tab === "people" || tab === "compose" ? (
                <div>
                  <dt className="theme-faint">marketing opt-ins</dt>
                  <dd className="mt-1 text-lg">
                    <AdminStatus tone={optedInCount > 0 ? "positive" : "neutral"}>
                      {optedInCount}
                    </AdminStatus>
                  </dd>
                </div>
              ) : null}
              {tab === "event-plan" ? (
                <div>
                  <dt className="theme-faint">scheduled stages</dt>
                  <dd className="mt-1 text-lg">
                    <AdminStatus tone={scheduledCount > 0 ? "attention" : "neutral"}>
                      {scheduledCount}
                    </AdminStatus>
                  </dd>
                </div>
              ) : null}
              {tab === "event-plan" || tab === "delivery" ? (
                <div>
                  <dt className="theme-faint">next send</dt>
                  <dd className="mt-1">
                    <AdminStatus tone={nextSend ? "attention" : "neutral"}>
                      {dateLabel(nextSend)}
                    </AdminStatus>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="theme-faint">email signals</dt>
                <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <AdminStatus tone={email.deliveryEventsConfigured ? "positive" : "neutral"}>
                    {email.deliveryEventsConfigured ? "delivery on" : "delivery off"}
                  </AdminStatus>
                  <AdminStatus tone={email.linkTrackingConfigured ? "positive" : "neutral"}>
                    {email.linkTrackingConfigured ? "clicks on" : "clicks off"}
                  </AdminStatus>
                </dd>
              </div>
            </dl>
            {email.provider === "mailpit" && email.mailpitUrl ? (
              <div className="mt-4 border-t theme-border pt-4 font-mono text-xs theme-muted">
                <span className="font-bold text-foreground">local capture</span>
                <span className="mx-2 theme-faint">·</span>
                Emails stay on this machine.{" "}
                <a
                  href={email.mailpitUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 transition-opacity hover:opacity-70"
                >
                  open the local inbox
                </a>
              </div>
            ) : null}
          </>
        )}
      </section>
      {hasLoaded && (tab === "people" || tab === "compose") ? (
        <div className="flex flex-wrap items-end gap-4">
          {tab === "people" ? (
            <label className="font-mono text-xs">
              search contacts
              <input
                value={contactQuery}
                onChange={(event) => setContactQuery(event.target.value)}
                className="ml-3 min-h-11 border theme-border bg-transparent px-3"
              />
            </label>
          ) : null}
          {contactsNextCursor ? (
            <button
              type="button"
              className="mh-action mh-action--secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const response = await authFetch(
                    `/api/admin/communications?${new URLSearchParams({ scope: "workspace", tab, q: contactQuery, cursor: contactsNextCursor })}`,
                  );
                  if (!response.ok) throw new Error("Could not load more contacts");
                  const data = (await response.json()) as {
                    contacts: Contact[];
                    contactsNextCursor: string | null;
                  };
                  setContacts((current) => [...current, ...data.contacts]);
                  setContactsNextCursor(data.contactsNextCursor);
                } catch (error) {
                  onError(error instanceof Error ? error.message : "Could not load contacts");
                } finally {
                  setBusy(false);
                }
              }}
            >
              load more contacts
            </button>
          ) : null}
        </div>
      ) : null}
      {hasLoaded && !loadError ? (
        <>
          <nav
            aria-label="Communications tools"
            className="flex flex-wrap gap-x-5 gap-y-3 border-b theme-border pb-3 font-mono text-xs"
          >
            {COMMUNICATION_TABS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                aria-current={tab === item ? "page" : undefined}
                className={`min-h-11 underline-offset-4 transition-opacity hover:opacity-70 ${tab === item ? "font-bold underline" : "theme-muted"}`}
              >
                {item === "event-plan"
                  ? "event plan"
                  : item === "people"
                    ? "audience & consent"
                    : item}
              </button>
            ))}
          </nav>
          {tab === "event-plan" ? (
            <EventPlanView
              events={events}
              selectedEvent={selectedEvent}
              setSelectedEvent={setSelectedEvent}
              activePlan={activePlan}
              preparePlan={preparePlan}
              planAction={planAction}
              busy={busy}
              editingStage={editingStage}
              stageDraft={stageDraft}
              setStageDraft={setStageDraft}
              openStage={openStage}
              saveStage={saveStage}
              resetStageTemplate={resetStageTemplate}
              setEditingStage={setEditingStage}
              stageRecipients={stageRecipients}
              stageDeliveries={stageDeliveries}
              viewStageRecipients={viewStageRecipients}
              previewStageEmail={previewStageEmail}
              stagePreview={stagePreview}
              setStagePreview={setStagePreview}
              testEmail={testEmail}
              setTestEmail={setTestEmail}
              sendTestPlan={sendTestPlan}
              sendStageNow={sendStageNow}
              sendStageToMissingRecipients={sendStageToMissingRecipients}
              deliveryRefreshMode={planDeliveryIsActive ? "settling" : "monitoring"}
              deliveryRefreshFailed={planRefreshFailed}
              deliveryAutoRefreshHalted={planRefreshHalted}
              deliveryCheckedAt={planCheckedAt}
              deliveryEventsConfigured={email.deliveryEventsConfigured === true}
            />
          ) : null}
          {tab === "compose" ? (
            <ComposeView
              events={events}
              kind={kind}
              setKind={setKind}
              audience={audience}
              setAudience={setAudience}
              audienceOptions={audienceOptions}
              composeEvent={composeEvent}
              setComposeEvent={setComposeEvent}
              subject={subject}
              setSubject={setSubject}
              body={body}
              setBody={setBody}
              mediaUrl={mediaUrl}
              setMediaUrl={setMediaUrl}
              mediaKind={mediaKind}
              setMediaKind={setMediaKind}
              mediaAlt={mediaAlt}
              setMediaAlt={setMediaAlt}
              posterUrl={posterUrl}
              setPosterUrl={setPosterUrl}
              scheduledAt={scheduledAt}
              setScheduledAt={setScheduledAt}
              contacts={filteredContacts}
              selected={selected}
              setSelected={setSelected}
              contactQuery={contactQuery}
              setContactQuery={setContactQuery}
              save={save}
              preview={preview}
              previewHtml={previewHtml}
              busy={busy}
              messages={messages}
              previewValues={previewValuesForEvent(
                events.find((event) => event.slug === composeEvent),
              )}
            />
          ) : null}
          {tab === "delivery" ? (
            <div className="space-y-10">
              <EmailOperationsPanel
                authFetch={authFetch}
                onError={onError}
                onStatus={onStatus}
                ensureStepUpToken={ensureStepUpToken}
                withStepUpHeaders={withStepUpHeaders}
                initialStatus={initialEmailStatus}
                initialQuery={initialEmailQuery}
              />
              <AlertSettings
                authFetch={authFetch}
                onError={onError}
                onStatus={onStatus}
                ensureStepUpToken={ensureStepUpToken}
                withStepUpHeaders={withStepUpHeaders}
              />
            </div>
          ) : null}
          {tab === "templates" ? (
            <TemplatesView
              templates={templates}
              draft={templateDraft}
              setDraft={setTemplateDraft}
              save={saveTemplate}
              archive={archiveTemplate}
              useTemplate={useTemplate}
              busy={busy}
            />
          ) : null}
          {tab === "feedback" ? (
            <FeedbackView
              surveys={surveys}
              events={events}
              draft={surveyDraft}
              setDraft={setSurveyDraft}
              save={saveSurveyDraft}
              newSurvey={newSurvey}
              loadResponses={loadResponses}
              selectedSurvey={selectedSurvey}
              responses={responses}
              invitations={surveyInvitations}
              busy={busy}
            />
          ) : null}
          {tab === "polls" ? (
            <PollsPanel
              authFetch={authFetch}
              events={events}
              onError={onError}
              onStatus={onStatus}
            />
          ) : null}
          {tab === "credits" ? (
            <CreditsPanel authFetch={authFetch} onError={onError} onStatus={onStatus} />
          ) : null}
          {tab === "people" ? (
            <PeopleView
              contacts={contacts}
              setPreference={async (contact, optedIn) => {
                try {
                  await post({ action: "set-preference", emailHash: contact.emailHash, optedIn });
                  setContacts((current) =>
                    current.map((item) =>
                      item.emailHash === contact.emailHash
                        ? { ...item, marketingOptedIn: optedIn }
                        : item,
                    ),
                  );
                  onStatus(
                    `${contact.email} ${optedIn ? "can receive marketing" : "is opted out"}.`,
                  );
                } catch (error) {
                  onError(error instanceof Error ? error.message : "Could not update permission");
                }
              }}
            />
          ) : null}
        </>
      ) : null}
      {dialog}
    </div>
  );
}
