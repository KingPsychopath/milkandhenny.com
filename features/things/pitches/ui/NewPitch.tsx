import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { createPitchFn } from "../pitches.functions";
import { rememberPitchCredential, saveLocalPitchDraft } from "../browser-store.client";
import { PITCH_DOCUMENT_SCHEMA_VERSION, type PitchDocument } from "../types";

function randomId(prefix = ""): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

function initialDocument(): PitchDocument {
  const now = Date.now();
  return {
    schemaVersion: PITCH_DOCUMENT_SCHEMA_VERSION,
    slides: [
      {
        id: randomId("s_"),
        name: "Slide 1",
        version: 1,
        updatedAt: now,
        elements: [],
        assetIds: {},
      },
    ],
  };
}

export function NewPitch({ maximumSlides }: { maximumSlides: number }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("saving");
    const ownerToken = randomId("k_");
    const createRequestId = randomId("c_");
    const document = initialDocument();
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
          serverVersion: result.value.deck.version,
          updatedAt: result.value.deck.updatedAt,
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

      <form onSubmit={submit} className="mt-12 space-y-8">
        <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
          pitch title
          <input
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-3 block min-h-14 w-full border-b theme-border-strong bg-transparent font-serif text-3xl normal-case tracking-normal text-foreground outline-none focus:border-foreground"
            autoFocus
          />
        </label>
        <div className="grid gap-8 sm:grid-cols-2">
          <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
            your name
            <input
              required
              maxLength={120}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent font-mono text-base normal-case tracking-normal text-foreground outline-none focus:border-foreground"
            />
          </label>
          <label className="block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
            recovery email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent font-mono text-base normal-case tracking-normal text-foreground outline-none focus:border-foreground"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={state === "saving"}
          className="min-h-13 w-full bg-foreground px-7 font-mono text-sm text-background hover:opacity-80 disabled:opacity-40"
        >
          {state === "saving" ? "opening the studio…" : "open the studio →"}
        </button>
        {state === "error" ? (
          <p className="font-mono text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
