"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type Kind = "newsletter" | "event_update" | "pitch_nudge" | "event_service" | "feedback";
type Audience = "marketing_opted_in" | "event_attendees" | "pitch_owners" | "selected";
type MediaKind = "image" | "gif" | "video";
type Contact = {
  emailHash: string;
  email: string;
  displayName: string | null;
  sources: string[];
  marketingOptedIn: boolean;
};
type EventOption = { slug: string; title: string; startsAt: string };
type Message = {
  id: string;
  kind: Kind;
  audience: Audience;
  subject: string;
  scheduledAt: string | null;
  status: string;
  recipientCount: number;
};
type Media = { kind: MediaKind; url: string; alt: string; posterUrl?: string };
type Template = {
  id: string;
  name: string;
  kind: Kind;
  subject: string;
  body: string;
  media: Media[];
  isDefault: boolean;
};
type Stage = {
  id: string;
  stageKey: string;
  label: string;
  position: number;
  kind: Kind;
  audience: Audience;
  subject: string;
  body: string;
  media: Media[];
  sendAt: string | null;
  status: string;
  recipientCount: number;
  queuedCount: number;
  surveyId: string | null;
};
type Plan = {
  id: string;
  eventSlug: string;
  eventTitle: string;
  name: string;
  status: string;
  stages: Stage[];
};
type SurveyQuestion = {
  id: string;
  type: "rating" | "long_text" | "single_choice" | "multi_choice" | "yes_no" | "email";
  label: string;
  hint?: string;
  required: boolean;
  options?: string[];
};
type Survey = {
  id: string;
  slug: string;
  eventSlug: string | null;
  title: string;
  intro: string;
  questions: SurveyQuestion[];
  status: "draft" | "open" | "closed" | "archived";
  responseCount: number;
};
type SurveyResponse = {
  id: string;
  respondentEmail: string | null;
  respondentName: string | null;
  answers: Record<string, string | string[]>;
  submittedAt: string;
};
type StageDraft = {
  subject: string;
  body: string;
  sendAt: string;
  mediaUrl: string;
  mediaKind: MediaKind;
  mediaAlt: string;
  posterUrl: string;
};
type TemplateDraft = {
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
type SurveyDraft = {
  id: string;
  slug: string;
  eventSlug: string;
  title: string;
  intro: string;
  status: Survey["status"];
  questions: SurveyQuestion[];
};

const KIND_LABELS: Record<Kind, string> = {
  newsletter: "newsletter",
  event_update: "event update",
  pitch_nudge: "pitch nudge",
  event_service: "event logistics",
  feedback: "feedback",
};

function dateLabel(value: string | null): string {
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

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="font-mono text-micro theme-muted">{label}</span>
      {rows ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          className="mt-2 w-full rounded border theme-border bg-transparent px-3 py-3 font-serif text-lg leading-relaxed text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
        />
      )}
      {hint ? (
        <span className="mt-2 block font-mono text-micro leading-relaxed theme-faint">{hint}</span>
      ) : null}
    </label>
  );
}

function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-10 rounded border px-4 font-mono text-xs transition-opacity hover:opacity-70 disabled:cursor-wait disabled:opacity-45 ${primary ? "border-transparent bg-foreground text-background" : "theme-border-strong text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function CommunicationsPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [tab, setTab] = useState<"event-plan" | "compose" | "templates" | "feedback" | "people">(
    "event-plan",
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState("after-school-club-2026-09-01");
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [stageDraft, setStageDraft] = useState<StageDraft>({
    subject: "",
    body: "",
    sendAt: "",
    mediaUrl: "",
    mediaKind: "image",
    mediaAlt: "",
    posterUrl: "",
  });
  const [stageRecipients, setStageRecipients] = useState<{
    stageId: string;
    count: number;
    recipients: Array<{ name: string | null; email: string }>;
  } | null>(null);
  const [stagePreview, setStagePreview] = useState<{ stageId: string; html: string } | null>(null);
  const [testEmail, setTestEmail] = useState("me@owenabel.com");
  const [kind, setKind] = useState<Kind>("newsletter");
  const [audience, setAudience] = useState<Audience>("marketing_opted_in");
  const [composeEvent, setComposeEvent] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaKind, setMediaKind] = useState<MediaKind>("image");
  const [mediaAlt, setMediaAlt] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contactQuery, setContactQuery] = useState("");
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>({
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
  const [surveyDraft, setSurveyDraft] = useState<SurveyDraft>({
    id: "",
    slug: "",
    eventSlug: "",
    title: "",
    intro: "",
    status: "draft",
    questions: [],
  });
  const [selectedSurvey, setSelectedSurvey] = useState<string | null>(null);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/communications");
      const data = (await response.json().catch(() => ({}))) as {
        contacts?: Contact[];
        messages?: Message[];
        events?: EventOption[];
        plans?: Plan[];
        templates?: Template[];
        surveys?: Survey[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load communications");
      setContacts(data.contacts || []);
      setMessages(data.messages || []);
      setEvents(data.events || []);
      setPlans(data.plans || []);
      setTemplates(data.templates || []);
      setSurveys(data.surveys || []);
      if (!selectedEvent && data.events?.[0]) setSelectedEvent(data.events[0].slug);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load communications");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError, selectedEvent]);
  useEffect(() => {
    void load();
  }, [load]);

  const activePlan = plans.find((plan) => plan.eventSlug === selectedEvent);
  const optedInCount = contacts.filter((contact) => contact.marketingOptedIn).length;
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
    return contacts
      .filter(
        (contact) =>
          !term ||
          contact.email.toLowerCase().includes(term) ||
          (contact.displayName || "").toLowerCase().includes(term),
      )
      .slice(0, 60);
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
    if (
      action === "schedule-plan" &&
      !window.confirm(
        "Schedule every stage in this plan? Each stage will fan out at its scheduled time.",
      )
    )
      return;
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
      sendAt: stage.sendAt ? stage.sendAt.slice(0, 16) : "",
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
        subject: stageDraft.subject,
        messageBody: stageDraft.body,
        sendAt: stageDraft.sendAt ? new Date(stageDraft.sendAt).toISOString() : null,
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
      onStatus("Stage saved as a draft.");
      setEditingStage(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save stage");
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
    if (
      !activePlan ||
      !window.confirm(`Send every email in this event plan to ${testEmail.trim()}?`)
    )
      return;
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
    if (!window.confirm(`Send “${stage.subject}” to the current valid ticket holders now?`)) return;
    setBusy(true);
    try {
      const data = (await post({ action: "send-stage-now", stageId: stage.id })) as {
        queued?: number;
      };
      onStatus(`${data.queued || 0} messages queued.`);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not send stage");
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
            : new Date(scheduledAt).toISOString();
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
    if (!window.confirm(`Archive “${template.name}”?`)) return;
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
    try {
      const response = await authFetch(`/api/admin/surveys/${survey.id}`);
      const data = (await response.json().catch(() => ({}))) as {
        responses?: SurveyResponse[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load feedback");
      setResponses(data.responses || []);
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
      status: "draft",
      questions: [{ id: "question-1", type: "long_text", label: "", required: true }],
    });
    setSelectedSurvey(null);
    setResponses([]);
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
    <div className="space-y-10">
      <section
        aria-labelledby="communications-summary-heading"
        className="border-y theme-border py-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              communications control
            </p>
            <h2
              id="communications-summary-heading"
              className="mt-2 font-serif text-3xl font-semibold tracking-tight"
            >
              A quiet place to send the right thing
            </h2>
            <p className="mt-3 max-w-2xl font-serif text-lg leading-relaxed theme-muted">
              Event plans, reusable templates, feedback, and people in one view. Ticket emails
              remain automatic service messages; marketing stays opt-in.
            </p>
          </div>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? "loading…" : "refresh"}
          </Button>
        </div>
        <dl className="mt-7 grid gap-4 border-t theme-border pt-5 font-mono text-xs sm:grid-cols-3">
          <div>
            <dt className="theme-faint">marketing opt-ins</dt>
            <dd className="mt-1 text-lg">{optedInCount}</dd>
          </div>
          <div>
            <dt className="theme-faint">scheduled stages</dt>
            <dd className="mt-1 text-lg">{scheduledCount}</dd>
          </div>
          <div>
            <dt className="theme-faint">next send</dt>
            <dd className="mt-1">{dateLabel(nextSend)}</dd>
          </div>
        </dl>
      </section>
      <nav
        aria-label="Communications tools"
        className="flex flex-wrap gap-x-5 gap-y-3 border-b theme-border pb-3 font-mono text-xs"
      >
        {(["event-plan", "compose", "templates", "feedback", "people"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`underline-offset-4 transition-opacity hover:opacity-70 ${tab === item ? "font-bold underline" : "theme-muted"}`}
          >
            {item === "event-plan" ? "event plan" : item}
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
          setEditingStage={setEditingStage}
          previewStage={previewStage}
          stageRecipients={stageRecipients}
          setStageRecipients={setStageRecipients}
          previewStageEmail={previewStageEmail}
          stagePreview={stagePreview}
          setStagePreview={setStagePreview}
          testEmail={testEmail}
          setTestEmail={setTestEmail}
          sendTestPlan={sendTestPlan}
          sendStageNow={sendStageNow}
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
        />
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
          busy={busy}
        />
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
              onStatus(`${contact.email} ${optedIn ? "can receive marketing" : "is opted out"}.`);
            } catch (error) {
              onError(error instanceof Error ? error.message : "Could not update permission");
            }
          }}
        />
      ) : null}
    </div>
  );
}

function EventPlanView(props: {
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
  setEditingStage: (value: string | null) => void;
  previewStage: (stage: Stage) => void;
  stageRecipients: {
    stageId: string;
    count: number;
    recipients: Array<{ name: string | null; email: string }>;
  } | null;
  setStageRecipients: (
    value: {
      stageId: string;
      count: number;
      recipients: Array<{ name: string | null; email: string }>;
    } | null,
  ) => void;
  previewStageEmail: (stage: Stage) => void;
  stagePreview: { stageId: string; html: string } | null;
  setStagePreview: (value: { stageId: string; html: string } | null) => void;
  testEmail: string;
  setTestEmail: (value: string) => void;
  sendTestPlan: () => void;
  sendStageNow: (stage: Stage) => void;
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
    setEditingStage,
    previewStage,
    stageRecipients,
    setStageRecipients,
    previewStageEmail,
    stagePreview,
    setStagePreview,
    testEmail,
    setTestEmail,
    sendTestPlan,
    sendStageNow,
  } = props;
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
          <select
            value={selectedEvent}
            onChange={(event) => setSelectedEvent(event.target.value)}
            className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
          >
            {events.map((event) => (
              <option key={event.slug} value={event.slug}>
                {event.title} · {shortDate(event.startsAt)}
              </option>
            ))}
          </select>
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
              <p className="mt-1 font-mono text-xs theme-muted">
                {activePlan.status} · five thoughtful stages · no duplicate ticket confirmation
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
          <div className="flex flex-wrap items-end gap-3 border-b theme-border py-4">
            <label className="min-w-[18rem] flex-1">
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
            <Button onClick={sendTestPlan} disabled={busy || !testEmail.trim()}>
              send all test emails
            </Button>
          </div>
          <ol className="mt-5 border-l theme-border pl-6">
            {activePlan.stages.map((stage) => (
              <li
                key={stage.id}
                className="relative border-b theme-border-faint pb-7 pt-2 last:border-0"
              >
                <span
                  className="absolute -left-[1.78rem] top-3 h-3 w-3 rounded-full border-2 border-background bg-[var(--prose-hashtag)]"
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                      {stage.label}
                    </p>
                    <h4 className="mt-2 font-serif text-2xl">{stage.subject}</h4>
                    <p className="mt-2 font-mono text-xs theme-muted">
                      {stage.sendAt ? dateLabel(stage.sendAt) : "needs a send time"} ·{" "}
                      {stage.status} · {stage.recipientCount || "recipient count at fan-out"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => previewStage(stage)}>see recipients</Button>
                    <Button onClick={() => previewStageEmail(stage)} disabled={busy}>
                      preview email
                    </Button>
                    <Button onClick={() => openStage(stage)}>edit</Button>
                    {stage.status !== "queued" && stage.status !== "complete" ? (
                      <Button onClick={() => sendStageNow(stage)} disabled={busy}>
                        send now
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
                      <button
                        type="button"
                        onClick={() => setStageRecipients(null)}
                        className="font-mono text-micro theme-muted underline underline-offset-4"
                      >
                        close
                      </button>
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
                      <p className="mt-2 font-mono text-micro theme-faint">showing the first 20</p>
                    ) : null}
                  </div>
                ) : null}
                {stagePreview?.stageId === stage.id ? (
                  <div className="mt-4 border-y theme-border-faint py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-xs">email preview</p>
                      <button
                        type="button"
                        onClick={() => setStagePreview(null)}
                        className="font-mono text-micro theme-muted underline underline-offset-4"
                      >
                        close
                      </button>
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
                      onChange={(value) => setStageDraft((draft) => ({ ...draft, subject: value }))}
                    />
                    <Field
                      label="message"
                      value={stageDraft.body}
                      onChange={(value) => setStageDraft((draft) => ({ ...draft, body: value }))}
                      rows={12}
                      hint="Use **bold**, - bullet points, [link text](https://…), and tokens such as {{event.venue}} or {{survey.url}}."
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="send at"
                        type="datetime-local"
                        value={stageDraft.sendAt}
                        onChange={(value) =>
                          setStageDraft((draft) => ({ ...draft, sendAt: value }))
                        }
                      />
                      <Field
                        label="media URL"
                        value={stageDraft.mediaUrl}
                        onChange={(value) =>
                          setStageDraft((draft) => ({ ...draft, mediaUrl: value }))
                        }
                        hint="GIFs and images appear in the email. Videos use a linked poster."
                      />
                    </div>
                    {stageDraft.mediaUrl ? (
                      <div className="grid gap-4 sm:grid-cols-3">
                        <label className="block">
                          <span className="font-mono text-micro theme-muted">media type</span>
                          <select
                            value={stageDraft.mediaKind}
                            onChange={(event) =>
                              setStageDraft((draft) => ({
                                ...draft,
                                mediaKind: event.target.value as MediaKind,
                              }))
                            }
                            className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
                          >
                            <option value="image">image</option>
                            <option value="gif">GIF</option>
                            <option value="video">video</option>
                          </select>
                        </label>
                        <Field
                          label="alt text"
                          value={stageDraft.mediaAlt}
                          onChange={(value) =>
                            setStageDraft((draft) => ({ ...draft, mediaAlt: value }))
                          }
                        />
                        <Field
                          label="poster URL"
                          value={stageDraft.posterUrl}
                          onChange={(value) =>
                            setStageDraft((draft) => ({ ...draft, posterUrl: value }))
                          }
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button primary onClick={saveStage} disabled={busy}>
                        save stage
                      </Button>
                      <Button onClick={() => setEditingStage(null)}>close</Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function ComposeView(props: {
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
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
            className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-micro theme-muted">audience</span>
          <select
            value={audience}
            onChange={(event) => setAudience(event.target.value as Audience)}
            className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
          >
            {audienceOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {["event_update", "event_service", "feedback"].includes(kind) ? (
        <label className="block">
          <span className="font-mono text-micro theme-muted">event</span>
          <select
            value={composeEvent}
            onChange={(event) => setComposeEvent(event.target.value)}
            className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
          >
            <option value="">choose an event</option>
            {events.map((event) => (
              <option key={event.slug} value={event.slug}>
                {event.title} · {shortDate(event.startsAt)}
              </option>
            ))}
          </select>
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
        <Field
          label="message"
          value={body}
          onChange={setBody}
          rows={12}
          hint="Use **bold**, - bullet points, [link text](https://…), and event tokens such as {{event.title}}."
        />
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <label className="block">
            <span className="font-mono text-micro theme-muted">media type</span>
            <select
              value={mediaKind}
              onChange={(event) => setMediaKind(event.target.value as MediaKind)}
              className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
            >
              <option value="image">image</option>
              <option value="gif">GIF</option>
              <option value="video">video link</option>
            </select>
          </label>
          <Field
            label="media URL"
            value={mediaUrl}
            onChange={setMediaUrl}
            hint="Use a public URL. The video option displays a linked poster."
          />
        </div>
        {mediaUrl ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="alt text" value={mediaAlt} onChange={setMediaAlt} />
            <Field label="poster URL (video only)" value={posterUrl} onChange={setPosterUrl} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[15rem] flex-1">
            <Field
              label="send at"
              type="datetime-local"
              value={scheduledAt}
              onChange={setScheduledAt}
              hint="The outbox queues recipients in bounded batches."
            />
          </div>
          <Button onClick={() => void preview()} disabled={busy || !subject.trim() || !body.trim()}>
            preview email
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
                  </div>
                  <p className="font-mono text-xs theme-muted">{message.status}</p>
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

function TemplatesView(props: {
  templates: Template[];
  draft: TemplateDraft;
  setDraft: React.Dispatch<React.SetStateAction<TemplateDraft>>;
  save: (event: FormEvent) => void;
  archive: (template: Template) => void;
  useTemplate: (template: Template) => void;
  busy: boolean;
}) {
  const { templates, draft, setDraft, save, archive, useTemplate, busy } = props;
  const set = (key: keyof TemplateDraft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));
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
                    setDraft({
                      id: template.id,
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
                  edit
                </Button>
              </div>
            </article>
          ))}
        </div>
        <form onSubmit={save} className="space-y-4">
          <p className="font-mono text-sm font-bold">
            {draft.id ? "edit template" : "new template"}
          </p>
          <Field
            label="template name"
            value={draft.name}
            onChange={(value) => set("name", value)}
            hint="For example: after school club · getting there"
          />
          <label className="block">
            <span className="font-mono text-micro theme-muted">type</span>
            <select
              value={draft.kind}
              onChange={(event) => set("kind", event.target.value)}
              className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="subject"
            value={draft.subject}
            onChange={(value) => set("subject", value)}
          />
          <Field
            label="message"
            value={draft.body}
            onChange={(value) => set("body", value)}
            rows={10}
            hint="Supports bold, bullets, links, and tokens."
          />
          <Field
            label="media URL"
            value={draft.mediaUrl}
            onChange={(value) => set("mediaUrl", value)}
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
            save template
          </Button>
        </form>
      </div>
    </section>
  );
}

function FeedbackView(props: {
  surveys: Survey[];
  events: EventOption[];
  draft: SurveyDraft;
  setDraft: React.Dispatch<React.SetStateAction<SurveyDraft>>;
  save: (event: FormEvent) => void;
  newSurvey: () => void;
  loadResponses: (survey: Survey) => void;
  selectedSurvey: string | null;
  responses: SurveyResponse[];
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
                      <p className="mt-1 font-mono text-micro theme-muted">
                        {survey.responseCount} responses · {survey.status}
                      </p>
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
              <select
                value={draft.eventSlug}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, eventSlug: event.target.value }))
                }
                className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
              >
                <option value="">standalone survey</option>
                {events.map((event) => (
                  <option key={event.slug} value={event.slug}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-micro theme-muted">status</span>
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value as Survey["status"],
                  }))
                }
                className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
              >
                <option value="draft">draft</option>
                <option value="open">open</option>
                <option value="closed">closed</option>
              </select>
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
                    <select
                      value={question.type}
                      onChange={(event) =>
                        updateQuestion(index, {
                          type: event.target.value as SurveyQuestion["type"],
                        })
                      }
                      className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"
                    >
                      <option value="rating">1–5 rating</option>
                      <option value="long_text">long answer</option>
                      <option value="yes_no">yes / no</option>
                      <option value="single_choice">one choice</option>
                      <option value="multi_choice">several choices</option>
                      <option value="email">email</option>
                    </select>
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

function ResponseList({ survey, responses }: { survey?: Survey; responses: SurveyResponse[] }) {
  if (!survey) return null;
  return (
    <div className="border-y theme-border py-5">
      <div>
        <p className="font-mono text-xs font-bold">responses</p>
        <p className="mt-1 font-mono text-micro theme-muted">{responses.length} loaded</p>
      </div>
      <div className="mt-5 space-y-5">
        {responses.length ? (
          responses.map((response) => (
            <article key={response.id} className="border-t theme-border-faint pt-4">
              <p className="font-mono text-micro theme-muted">
                {response.respondentName || "anonymous"}
                {response.respondentEmail ? ` · ${response.respondentEmail}` : ""} ·{" "}
                {dateLabel(response.submittedAt)}
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
    </div>
  );
}

function PeopleView({
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
          people and consent
        </p>
        <h3 id="people-heading" className="mt-2 font-serif text-3xl tracking-tight">
          Know who can receive what
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
