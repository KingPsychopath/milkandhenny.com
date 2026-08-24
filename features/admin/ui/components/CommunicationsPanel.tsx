"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type Kind = "newsletter" | "event_update" | "pitch_nudge";
type Audience = "marketing_opted_in" | "event_attendees" | "pitch_owners" | "selected";
type Contact = { emailHash: string; email: string; displayName: string | null; sources: string[]; marketingOptedIn: boolean };
type Message = { id: string; kind: Kind; audience: Audience; subject: string; scheduledAt: string | null; status: string; recipientCount: number };
type EventOption = { slug: string; title: string; startsAt: string };

const KIND_LABELS: Record<Kind, string> = { newsletter: "newsletter", event_update: "event update", pitch_nudge: "pitch nudge" };

function dateLabel(value: string | null): string {
  if (!value) return "not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown time" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
}

function Field({ label, value, onChange, type = "text", hint }: { label: string; value: string; onChange: (value: string) => void; type?: string; hint?: string }) {
  return <label className="block"><span className="font-mono text-micro theme-muted">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]" />{hint ? <span className="mt-1 block font-mono text-micro theme-faint">{hint}</span> : null}</label>;
}

export function CommunicationsPanel({ authFetch, onError, onStatus }: { authFetch: AuthFetch; onError: (message: string) => void; onStatus: (message: string) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>("newsletter");
  const [audience, setAudience] = useState<Audience>("marketing_opted_in");
  const [eventSlug, setEventSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [mediaKind, setMediaKind] = useState<"image" | "gif" | "video">("image");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaAlt, setMediaAlt] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contactQuery, setContactQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/communications");
      const data = (await response.json().catch(() => ({}))) as { contacts?: Contact[]; messages?: Message[]; events?: EventOption[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load communications");
      setContacts(data.contacts || []); setMessages(data.messages || []); setEvents(data.events || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load communications");
    } finally { setLoading(false); }
  }, [authFetch, onError]);
  useEffect(() => { void load(); }, [load]);

  const filteredContacts = useMemo(() => {
    const term = contactQuery.trim().toLowerCase();
    return contacts.filter((contact) => !term || contact.email.toLowerCase().includes(term) || (contact.displayName || "").toLowerCase().includes(term)).slice(0, 40);
  }, [contacts, contactQuery]);
  const optedInCount = contacts.filter((contact) => contact.marketingOptedIn).length;
  const scheduledCount = messages.filter((message) => message.status === "scheduled").length;
  const nextMessage = messages.filter((message) => message.status === "scheduled" && message.scheduledAt).sort((a, b) => Date.parse(a.scheduledAt || "") - Date.parse(b.scheduledAt || ""))[0];
  const audienceOptions = useMemo(() => kind === "newsletter" ? [["marketing_opted_in", "people who opted in"], ["selected", "selected people"]] as const : kind === "event_update" ? [["event_attendees", "event ticket holders"], ["selected", "selected people"]] as const : [["pitch_owners", "unfinished pitch owners"], ["selected", "selected people"]] as const, [kind]);
  useEffect(() => { if (!audienceOptions.some(([value]) => value === audience)) setAudience(audienceOptions[0][0]); }, [audience, audienceOptions]);

  const toggleContact = (emailHash: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(emailHash)) next.delete(emailHash); else next.add(emailHash);
    return next;
  });

  const setPreference = async (contact: Contact, optedIn: boolean) => {
    try {
      const response = await authFetch("/api/admin/communications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-preference", emailHash: contact.emailHash, optedIn }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update preference");
      setContacts((current) => current.map((item) => item.emailHash === contact.emailHash ? { ...item, marketingOptedIn: optedIn } : item));
      onStatus(contact.email + (optedIn ? " can receive marketing." : " opted out."));
    } catch (error) { onError(error instanceof Error ? error.message : "Could not update preference"); }
  };

  const save = async (mode: "draft" | "schedule" | "now") => {
    setBusy(true);
    try {
      const media = mediaUrl.trim() ? [{ kind: mediaKind, url: mediaUrl.trim(), alt: mediaAlt.trim(), ...(posterUrl.trim() ? { posterUrl: posterUrl.trim() } : {}) }] : [];
      const sendAt = mode === "draft" ? null : mode === "now" ? new Date().toISOString() : new Date(scheduledAt).toISOString();
      const response = await authFetch("/api/admin/communications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, audience, eventSlug: eventSlug || null, subject, body, media, selectedContactHashes: [...selected], scheduledAt: sendAt }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save communication");
      onStatus(mode === "draft" ? "Draft saved." : mode === "now" ? "Message queued to send now." : "Message scheduled.");
      setSubject(""); setBody(""); setMediaUrl(""); setMediaAlt(""); setPosterUrl(""); setScheduledAt(""); setSelected(new Set());
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not save communication"); }
    finally { setBusy(false); }
  };

  const cancel = async (message: Message) => {
    if (!window.confirm("Cancel “" + message.subject + "”?")) return;
    try {
      const response = await authFetch("/api/admin/communications/" + message.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not cancel message");
      onStatus("Communication cancelled."); await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not cancel message"); }
  };

  return <div className="space-y-10">
    <section aria-labelledby="communications-summary-heading" className="border-y theme-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">communications control</p><h2 id="communications-summary-heading" className="mt-2 font-serif text-3xl font-semibold">Prepare, schedule, send</h2><p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">Newsletters use marketing opt-in. Tickets, event changes, and pitch access remain service messages.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="min-h-10 font-mono text-xs theme-muted hover:opacity-70 disabled:opacity-50">{loading ? "loading…" : "refresh"}</button></div>
      <dl className="mt-6 grid gap-4 border-t theme-border pt-4 font-mono text-xs sm:grid-cols-3"><div><dt className="theme-faint">marketing opt-ins</dt><dd className="mt-1 text-lg">{optedInCount}</dd></div><div><dt className="theme-faint">scheduled</dt><dd className="mt-1 text-lg">{scheduledCount}</dd></div><div><dt className="theme-faint">next send</dt><dd className="mt-1">{nextMessage ? dateLabel(nextMessage.scheduledAt) : "nothing scheduled"}</dd></div></dl>
    </section>

    <section aria-labelledby="compose-heading" className="border-b theme-border pb-8">
      <h3 id="compose-heading" className="font-mono text-sm font-bold">new communication</h3><p className="mt-1 font-mono text-xs theme-muted">Save a draft while preparing. Images and GIFs display inline. Videos use a linked poster.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2"><label className="block"><span className="font-mono text-micro theme-muted">message type</span><select value={kind} onChange={(event) => setKind(event.target.value as Kind)} className="mt-1 min-h-10 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm">{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block"><span className="font-mono text-micro theme-muted">audience</span><select value={audience} onChange={(event) => setAudience(event.target.value as Audience)} className="mt-1 min-h-10 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm">{audienceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {kind === "event_update" ? <label className="mt-4 block"><span className="font-mono text-micro theme-muted">event</span><select value={eventSlug} onChange={(event) => setEventSlug(event.target.value)} className="mt-1 min-h-10 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"><option value="">choose an event</option>{events.map((event) => <option key={event.slug} value={event.slug}>{event.title} · {dateLabel(event.startsAt)}</option>)}</select></label> : null}
      {audience === "selected" ? <div className="mt-4"><Field label="find people" value={contactQuery} onChange={setContactQuery} hint={String(selected.size) + " selected"} /><div className="mt-2 max-h-48 overflow-auto border-y theme-border">{filteredContacts.map((contact) => <label key={contact.emailHash} className="flex min-h-10 cursor-pointer items-center gap-2 border-b theme-border-faint py-2 last:border-0"><input type="checkbox" checked={selected.has(contact.emailHash)} onChange={() => toggleContact(contact.emailHash)} /><span className="truncate font-mono text-xs">{contact.displayName || contact.email}</span><span className="ml-auto truncate font-mono text-micro theme-faint">{contact.email}</span></label>)}</div></div> : null}
      <div className="mt-4 space-y-4"><Field label="subject" value={subject} onChange={setSubject} /><label className="block"><span className="font-mono text-micro theme-muted">message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={8} placeholder="A short note with one clear reason to click." className="mt-1 w-full rounded border theme-border bg-transparent px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]" /><span className="mt-1 block font-mono text-micro theme-faint">Plain text. Blank lines create paragraphs.</span></label>
        <div className="grid gap-3 md:grid-cols-[8rem_1fr]"><label className="block"><span className="font-mono text-micro theme-muted">media type</span><select value={mediaKind} onChange={(event) => setMediaKind(event.target.value as typeof mediaKind)} className="mt-1 min-h-10 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm"><option value="image">image</option><option value="gif">GIF</option><option value="video">video link</option></select></label><Field label="media URL" value={mediaUrl} onChange={setMediaUrl} hint="Public image or GIF URL. Video emails use a linked poster." /></div>
        {mediaUrl ? <div className="grid gap-3 md:grid-cols-2"><Field label="alt text" value={mediaAlt} onChange={setMediaAlt} /><Field label="poster URL (video only)" value={posterUrl} onChange={setPosterUrl} /></div> : null}
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end"><Field label="send at" type="datetime-local" value={scheduledAt} onChange={setScheduledAt} hint="The durable outbox sends at this instant." /><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void save("draft")} className="min-h-10 rounded border theme-border-strong px-4 font-mono text-xs disabled:opacity-50">save draft</button><button type="button" disabled={busy || !subject.trim() || !body.trim() || !scheduledAt} onClick={() => void save("schedule")} className="min-h-10 rounded bg-foreground px-4 font-mono text-xs text-background hover:opacity-90 disabled:opacity-50">schedule</button><button type="button" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void save("now")} className="min-h-10 font-mono text-xs theme-muted hover:opacity-70 disabled:opacity-50">send now</button></div></div>
      </div>
    </section>

    <section aria-labelledby="scheduled-heading" className="border-b theme-border pb-8"><h3 id="scheduled-heading" className="font-mono text-sm font-bold">planned and recent</h3><div className="mt-3 divide-y theme-border">{messages.length === 0 ? <p className="py-4 font-mono text-xs theme-muted">No communications prepared yet.</p> : messages.map((message) => <article key={message.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-serif text-xl">{message.subject}</p><p className="mt-1 font-mono text-micro theme-muted">{KIND_LABELS[message.kind]} · {message.audience.replaceAll("_", " ")} · {message.recipientCount} people</p></div><p className="font-mono text-xs theme-muted">{message.status}</p></div><p className="mt-2 font-mono text-xs theme-faint">{message.scheduledAt ? "send " + dateLabel(message.scheduledAt) : "draft · not scheduled"}</p>{message.status === "draft" || message.status === "scheduled" ? <button type="button" onClick={() => void cancel(message)} className="mt-2 font-mono text-xs theme-muted underline underline-offset-4 hover:opacity-70">cancel</button> : null}</article>)}</div></section>

    <section aria-labelledby="contacts-heading"><h3 id="contacts-heading" className="font-mono text-sm font-bold">people and marketing permission</h3><p className="mt-1 font-mono text-xs leading-relaxed theme-muted">Service messages do not depend on this switch. Marketing messages do.</p><div className="mt-4 border-y theme-border">{contacts.map((contact) => <div key={contact.emailHash} className="flex flex-wrap items-center gap-3 border-b theme-border-faint py-3 last:border-0"><div className="min-w-0 flex-1"><p className="truncate font-mono text-xs">{contact.displayName || "unnamed person"} · {contact.email}</p><p className="mt-1 font-mono text-micro theme-faint">{contact.sources.join(" · ") || "source unknown"}</p></div><button type="button" onClick={() => void setPreference(contact, !contact.marketingOptedIn)} className={"min-h-9 rounded border px-3 font-mono text-micro " + (contact.marketingOptedIn ? "border-transparent bg-foreground text-background" : "theme-border-strong text-foreground")}>{contact.marketingOptedIn ? "marketing on" : "marketing off"}</button></div>)}{contacts.length === 0 && !loading ? <p className="py-4 font-mono text-xs theme-muted">No people have been found in tickets or pitches.</p> : null}</div></section>
  </div>;
}
