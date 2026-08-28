import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useBrowserProfileForm } from "@/lib/client/browser-profile";
import { BrowserProfileHint } from "@/components/BrowserProfileHint";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { isValidEmail } from "@/lib/shared/email-address";
import { createPitchFn } from "../pitches.functions";
import { rememberPitchCredential, saveLocalPitchDraft } from "../browser-store.client";
import { createEmptyPitchDocument } from "../new-document.client";
import type { PitchCreatorIdentity, PitchOperationalStatus } from "../types";
import { PitchDemoEntry } from "./PitchDemoEntry";

function randomId(prefix = ""): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function NewPitch({
  maximumSlides,
  operationalStatus,
  creatorIdentity,
  emailDestination,
}: {
  maximumSlides: number;
  operationalStatus: PitchOperationalStatus;
  creatorIdentity: PitchCreatorIdentity | null;
  emailDestination: "inbox" | "mailpit" | "unavailable";
}) {
  const navigate = useNavigate();
  const { name, email, setName, setEmail, remember } = useBrowserProfileForm();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error" | "email-warning">("idle");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const createRequest = useRef<{ id: string; ownerToken: string } | undefined>(undefined);
  const [createdDeckId, setCreatedDeckId] = useState<string>();

  useEffect(() => setHydrated(true), []);

  async function createPitch() {
    if (createdDeckId) {
      await navigate({ to: "/things/pitches/$deckId/edit", params: { deckId: createdDeckId } });
      return;
    }
    if (state === "saving") return;
    if (!operationalStatus.canWrite) {
      setState("error");
      setError(operationalStatus.message);
      return;
    }
    if (!title.trim()) {
      setState("error");
      setError("Add a pitch title before opening the studio.");
      return;
    }
    const ownerName = creatorIdentity?.name ?? name;
    const ownerEmail = creatorIdentity?.email ?? email;
    if (!ownerName.trim()) {
      setState("error");
      setError("Add your name so we know who owns this pitch.");
      return;
    }
    if (!isValidEmail(ownerEmail)) {
      setState("error");
      setError("Enter a valid recovery email so you can get back to this pitch.");
      return;
    }
    setState("saving");
    createRequest.current ??= { id: randomId("c_"), ownerToken: randomId("k_") };
    const { id: createRequestId, ownerToken } = createRequest.current;
    const document = createEmptyPitchDocument();
    try {
      const result = await createPitchFn({
        data: {
          createRequestId,
          ownerName,
          ownerEmail,
          ownerToken,
          title,
          document,
        },
      });
      if (!result.ok) {
        setState("error");
        setError(result.error);
        return;
      }
      remember({ name: ownerName, email: ownerEmail });
      await Promise.all([
        rememberPitchCredential({
          deckId: result.value.deck.id,
          token: ownerToken,
          title: result.value.deck.title,
          ownerName: result.value.deck.ownerName,
          updatedAt: result.value.deck.updatedAt,
        }),
        saveLocalPitchDraft({
          deckId: result.value.deck.id,
          title: result.value.deck.title,
          document,
          files: {},
          pendingSync: false,
          updatedAt: result.value.deck.updatedAt,
          pendingOperations: [],
          nextSequence: 1,
        }),
      ]);
      if (!result.value.emailQueued) {
        setCreatedDeckId(result.value.deck.id);
        setState("email-warning");
        setError(
          "Your pitch is safe here and attached to your account, but the recovery email could not be queued.",
        );
        return;
      }
      await navigate({
        to: "/things/pitches/$deckId/edit",
        params: { deckId: result.value.deck.id },
      });
    } catch {
      setState("error");
      setError(
        navigator.onLine
          ? "Could not create the pitch. Try again."
          : "Connect once to open a new pitch. After that, editing works offline.",
      );
    }
  }

  return (
    <main id="main" className="mx-auto min-h-screen max-w-2xl px-6 pb-24 pt-16">
      <Link to="/things/pitches" className="font-mono text-xs theme-muted hover:opacity-60">
        ← pitch wall
      </Link>
      <p className="mt-16 font-mono text-micro uppercase tracking-[0.18em] theme-muted">
        a new argument
      </p>
      <h1 className="mt-3 font-serif text-5xl text-foreground sm:text-6xl">
        What are you selling us?
      </h1>
      <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed theme-muted">
        You get up to {maximumSlides} slides. Your account owns the pitch when you are signed in;
        this browser also keeps an offline safety copy and a private editing key.
      </p>

      {emailDestination === "mailpit" ? (
        <p
          className="mt-6 border-y theme-border py-3 font-mono text-xs leading-relaxed"
          role="status"
        >
          Local email is captured by Mailpit at 127.0.0.1:8025. It will not reach your real inbox.
        </p>
      ) : emailDestination === "unavailable" ? (
        <p
          className="mt-6 border-y theme-border py-3 font-mono text-xs leading-relaxed"
          role="status"
        >
          Recovery email is currently unavailable. Signed-in pitches will still stay with your
          account.
        </p>
      ) : null}

      {!operationalStatus.canWrite ? (
        <p
          className="mt-8 border-y border-[var(--things-amber)] bg-[var(--selection-bg)] px-4 py-3 font-mono text-xs text-[var(--selection-fg)]"
          role="status"
        >
          {operationalStatus.message} You can still use the private rehearsal below.
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void createPitch();
        }}
        noValidate
        className="mt-12 space-y-8"
      >
        <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
          pitch title
          <input
            required
            disabled={!hydrated || state === "saving" || !operationalStatus.canWrite}
            maxLength={120}
            value={title}
            aria-invalid={state === "error" && !title.trim()}
            aria-describedby="new-pitch-error"
            onChange={(event) => {
              setTitle(event.target.value);
              setError("");
              setState("idle");
            }}
            className="mt-3 block min-h-14 w-full border-b theme-border-strong bg-transparent font-serif text-3xl normal-case tracking-normal text-foreground outline-none focus:border-foreground"
            autoFocus
          />
        </label>
        {creatorIdentity ? (
          <div className="border-y theme-border py-4">
            <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
              saving to your account
            </p>
            <p className="mt-2 font-serif text-xl text-foreground">{creatorIdentity.name}</p>
            <p className="mt-1 font-mono text-xs theme-muted">{creatorIdentity.email}</p>
          </div>
        ) : (
          <div className="grid gap-8 sm:grid-cols-2">
            <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
              your name
              <input
                name="name"
                required
                disabled={!hydrated || state === "saving" || !operationalStatus.canWrite}
                maxLength={120}
                autoComplete="name"
                value={name}
                aria-invalid={state === "error" && !name.trim()}
                aria-describedby="new-pitch-error"
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                  setState("idle");
                }}
                className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent font-mono text-base normal-case tracking-normal text-foreground outline-none focus:border-foreground"
              />
            </label>
            <div>
              <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
                recovery email
                <input
                  name="email"
                  required
                  disabled={!hydrated || state === "saving" || !operationalStatus.canWrite}
                  type="email"
                  autoComplete="email"
                  value={email}
                  aria-invalid={state === "error" && !isValidEmail(email)}
                  aria-describedby="new-pitch-error"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError("");
                    setState("idle");
                  }}
                  className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent font-mono text-base normal-case tracking-normal text-foreground outline-none focus:border-foreground"
                />
              </label>
              <EmailAddressNotice email={email} onAcceptSuggestion={setEmail} />
            </div>
          </div>
        )}
        {!creatorIdentity ? <BrowserProfileHint /> : null}
        <button
          type="submit"
          disabled={!hydrated || state === "saving" || !operationalStatus.canWrite}
          className="min-h-13 w-full bg-foreground px-7 font-mono text-sm text-background hover:opacity-80 disabled:opacity-40"
        >
          {state === "saving"
            ? "opening the studio…"
            : createdDeckId
              ? "continue to the studio →"
              : "open the studio →"}
        </button>
        {state === "error" || state === "email-warning" ? (
          <p
            id="new-pitch-error"
            className="font-mono text-sm text-red-700 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-12 border-t theme-border pt-8">
        <p className="font-serif text-lg text-foreground">Not ready to introduce yourself?</p>
        <PitchDemoEntry className="mt-4 max-w-sm" />
      </div>
    </main>
  );
}
