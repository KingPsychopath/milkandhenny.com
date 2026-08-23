import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { createPitchFn } from "../pitches.functions";
import { rememberPitchCredential, saveLocalPitchDraft } from "../browser-store.client";
import { createEmptyPitchDocument } from "../new-document.client";
import { PitchDemoEntry } from "./PitchDemoEntry";

function randomId(prefix = ""): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function NewPitch({ maximumSlides }: { maximumSlides: number }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const createRequest = useRef<{ id: string; ownerToken: string } | undefined>(undefined);

  useEffect(() => setHydrated(true), []);

  async function createPitch() {
    if (state === "saving") return;
    if (!title.trim()) {
      setState("error");
      setError("Add a pitch title before opening the studio.");
      return;
    }
    if (!name.trim()) {
      setState("error");
      setError("Add your name so we know who owns this pitch.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
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
          ownerName: name,
          ownerEmail: email,
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
        You get up to {maximumSlides} slides. This browser remembers the private editing key; your
        email is only there to recover it.
      </p>

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
            disabled={!hydrated || state === "saving"}
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
        <div className="grid gap-8 sm:grid-cols-2">
          <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
            your name
            <input
              required
              disabled={!hydrated || state === "saving"}
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
          <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
            recovery email
            <input
              required
              disabled={!hydrated || state === "saving"}
              type="email"
              autoComplete="email"
              value={email}
              aria-invalid={state === "error" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
              aria-describedby="new-pitch-error"
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
                setState("idle");
              }}
              className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent font-mono text-base normal-case tracking-normal text-foreground outline-none focus:border-foreground"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={!hydrated || state === "saving"}
          className="min-h-13 w-full bg-foreground px-7 font-mono text-sm text-background hover:opacity-80 disabled:opacity-40"
        >
          {state === "saving" ? "opening the studio…" : "open the studio →"}
        </button>
        {state === "error" ? (
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
