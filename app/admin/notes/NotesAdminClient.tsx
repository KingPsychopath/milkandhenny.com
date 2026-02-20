"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type NoteVisibility = "public" | "unlisted" | "private";

type NoteMeta = {
  slug: string;
  title: string;
  subtitle?: string;
  visibility: NoteVisibility;
  updatedAt: string;
};

type NoteRecord = {
  meta: NoteMeta;
  markdown: string;
};

type ShareLink = {
  id: string;
  slug: string;
  expiresAt: string;
  pinRequired: boolean;
  revokedAt?: string;
  updatedAt: string;
};

export function NotesAdminClient() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [current, setCurrent] = useState<NoteRecord | null>(null);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const [createSlug, setCreateSlug] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createSubtitle, setCreateSubtitle] = useState("");
  const [createVisibility, setCreateVisibility] = useState<NoteVisibility>("private");
  const [createMarkdown, setCreateMarkdown] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");
  const [editVisibility, setEditVisibility] = useState<NoteVisibility>("private");
  const [editMarkdown, setEditMarkdown] = useState("");

  const loadNotes = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notes?limit=200");
      const data = (await res.json().catch(() => ({}))) as { notes?: NoteMeta[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load notes");
      setNotes(data.notes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadNote = useCallback(async (slug: string) => {
    if (!slug) return;
    setBusy(true);
    setError("");
    try {
      const [noteRes, sharesRes] = await Promise.all([
        fetch(`/api/notes/${encodeURIComponent(slug)}`),
        fetch(`/api/notes/${encodeURIComponent(slug)}/shares`),
      ]);
      const noteData = (await noteRes.json().catch(() => ({}))) as NoteRecord & { error?: string };
      const shareData = (await sharesRes.json().catch(() => ({}))) as { links?: ShareLink[]; error?: string };
      if (!noteRes.ok) throw new Error(noteData.error ?? "Failed to load note");
      if (!sharesRes.ok) throw new Error(shareData.error ?? "Failed to load share links");

      setCurrent(noteData);
      setEditTitle(noteData.meta.title);
      setEditSubtitle(noteData.meta.subtitle ?? "");
      setEditVisibility(noteData.meta.visibility);
      setEditMarkdown(noteData.markdown);
      setShares(shareData.links ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load note");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!selectedSlug && notes[0]) setSelectedSlug(notes[0].slug);
  }, [notes, selectedSlug]);

  useEffect(() => {
    if (selectedSlug) void loadNote(selectedSlug);
  }, [selectedSlug, loadNote]);

  const selected = useMemo(
    () => notes.find((n) => n.slug === selectedSlug) ?? null,
    [notes, selectedSlug]
  );

  async function createNote() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: createSlug,
          title: createTitle,
          subtitle: createSubtitle || undefined,
          visibility: createVisibility,
          markdown: createMarkdown,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { meta?: NoteMeta; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create note");
      setStatus("note created");
      setCreateSlug("");
      setCreateTitle("");
      setCreateSubtitle("");
      setCreateMarkdown("");
      await loadNotes();
      if (data.meta?.slug) setSelectedSlug(data.meta.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!selectedSlug) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(selectedSlug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          subtitle: editSubtitle,
          visibility: editVisibility,
          markdown: editMarkdown,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save note");
      setStatus("note saved");
      await loadNotes();
      await loadNote(selectedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentNote() {
    if (!selectedSlug) return;
    if (!window.confirm(`Delete note "${selectedSlug}"?`)) return;

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(selectedSlug)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete note");
      setStatus("note deleted");
      setCurrent(null);
      setShares([]);
      setSelectedSlug("");
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setBusy(false);
    }
  }

  async function createShare() {
    if (!selectedSlug) return;
    const withPin = window.confirm("Protect this new share link with a PIN?");
    const pin = withPin ? window.prompt("Enter share PIN") ?? "" : "";

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(selectedSlug)}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiresInDays: 7,
          pinRequired: withPin,
          pin: withPin ? pin : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        link?: ShareLink;
        token?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to create share link");
      const shareUrl = `${window.location.origin}/notes/${selectedSlug}?share=${encodeURIComponent(data.token ?? "")}`;
      await navigator.clipboard.writeText(shareUrl);
      setStatus("share link created and copied");
      await loadNote(selectedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSharePin(link: ShareLink) {
    const enable = !link.pinRequired;
    const pin = enable ? window.prompt("Set PIN for this link") ?? "" : null;
    if (enable && !pin) return;

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(enable ? { pinRequired: true, pin } : { pinRequired: false }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update share link");
      setStatus(enable ? "PIN enabled" : "PIN removed");
      await loadNote(link.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update share link");
    } finally {
      setBusy(false);
    }
  }

  async function rotateShare(link: ShareLink) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotateToken: true }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to rotate link");
      if (data.token) {
        const shareUrl = `${window.location.origin}/notes/${link.slug}?share=${encodeURIComponent(data.token)}`;
        await navigator.clipboard.writeText(shareUrl);
      }
      setStatus("share link rotated and copied");
      await loadNote(link.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate share link");
    } finally {
      setBusy(false);
    }
  }

  async function revokeShare(link: ShareLink) {
    if (!window.confirm("Revoke this share link?")) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to revoke link");
      setStatus("share link revoked");
      await loadNote(link.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 pt-12 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-tighter">admin · notes</h1>
          <p className="font-mono text-xs theme-muted mt-1">private markdown + share links</p>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs">
          <Link href="/admin" className="theme-muted hover:text-foreground transition-colors">
            admin home
          </Link>
          <Link href="/notes" className="theme-muted hover:text-foreground transition-colors">
            open notes
          </Link>
        </div>
      </header>

      {(status || error) && (
        <div className="mb-4 font-mono text-xs">
          {status ? <p className="text-green-600">{status}</p> : null}
          {error ? <p className="text-red-500">{error}</p> : null}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3 border theme-border rounded-md p-3 h-fit">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs theme-muted">notes</p>
            <button
              type="button"
              onClick={() => void loadNotes()}
              className="font-mono text-xs underline"
            >
              refresh
            </button>
          </div>
          <div className="space-y-1 max-h-[380px] overflow-auto">
            {notes.map((note) => (
              <button
                type="button"
                key={note.slug}
                onClick={() => setSelectedSlug(note.slug)}
                className={`w-full text-left rounded px-2 py-2 border transition-colors ${
                  selectedSlug === note.slug ? "border-[var(--foreground)]" : "theme-border"
                }`}
              >
                <p className="font-mono text-xs">{note.slug}</p>
                <p className="font-serif text-sm leading-tight mt-1">{note.title}</p>
                <p className="font-mono text-micro theme-muted mt-1">{note.visibility}</p>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-6">
          <div className="border theme-border rounded-md p-4 space-y-3">
            <h2 className="font-mono text-xs theme-muted">create note</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value)}
                placeholder="slug"
                className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
              />
              <input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="title"
                className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
              />
            </div>
            <input
              value={createSubtitle}
              onChange={(e) => setCreateSubtitle(e.target.value)}
              placeholder="subtitle (optional)"
              className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
            />
            <select
              value={createVisibility}
              onChange={(e) => setCreateVisibility(e.target.value as NoteVisibility)}
              className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
            >
              <option value="private">private</option>
              <option value="unlisted">unlisted</option>
              <option value="public">public</option>
            </select>
            <textarea
              value={createMarkdown}
              onChange={(e) => setCreateMarkdown(e.target.value)}
              placeholder="markdown"
              rows={8}
              className="w-full bg-transparent border theme-border rounded px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void createNote()}
              disabled={busy}
              className="font-mono text-xs px-3 py-2 rounded border theme-border"
            >
              {busy ? "working..." : "create note"}
            </button>
          </div>

          {selected ? (
            <div className="border theme-border rounded-md p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-mono text-xs theme-muted">edit · {selected.slug}</h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="font-mono text-xs underline"
                  >
                    {showPreview ? "edit mode" : "preview"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteCurrentNote()}
                    className="font-mono text-xs text-red-500"
                  >
                    delete
                  </button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
                />
                <input
                  value={editSubtitle}
                  onChange={(e) => setEditSubtitle(e.target.value)}
                  placeholder="subtitle"
                  className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
                />
              </div>

              <select
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as NoteVisibility)}
                className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
              >
                <option value="private">private</option>
                <option value="unlisted">unlisted</option>
                <option value="public">public</option>
              </select>

              {showPreview ? (
                <div className="border theme-border rounded p-3 prose-blog font-serif">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{editMarkdown}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={editMarkdown}
                  onChange={(e) => setEditMarkdown(e.target.value)}
                  rows={14}
                  className="w-full bg-transparent border theme-border rounded px-3 py-2 font-mono text-xs"
                />
              )}

              <button
                type="button"
                onClick={() => void saveNote()}
                disabled={busy}
                className="font-mono text-xs px-3 py-2 rounded border theme-border"
              >
                {busy ? "saving..." : "save note"}
              </button>
            </div>
          ) : null}

          {selected ? (
            <div className="border theme-border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs theme-muted">share links</h2>
                <button type="button" onClick={() => void createShare()} className="font-mono text-xs underline">
                  create share link
                </button>
              </div>
              <div className="space-y-2">
                {shares.length === 0 ? (
                  <p className="font-mono text-xs theme-muted">no share links</p>
                ) : (
                  shares.map((link) => (
                    <div key={link.id} className="border theme-border rounded p-3">
                      <p className="font-mono text-xs">{link.id}</p>
                      <p className="font-mono text-micro theme-muted mt-1">
                        expires {new Date(link.expiresAt).toLocaleString()} ·{" "}
                        {link.revokedAt ? "revoked" : "active"} · {link.pinRequired ? "pin on" : "pin off"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs">
                        <button type="button" onClick={() => void toggleSharePin(link)} className="underline">
                          {link.pinRequired ? "remove pin" : "require pin"}
                        </button>
                        <button type="button" onClick={() => void rotateShare(link)} className="underline">
                          rotate token
                        </button>
                        {!link.revokedAt && (
                          <button type="button" onClick={() => void revokeShare(link)} className="text-red-500">
                            revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
