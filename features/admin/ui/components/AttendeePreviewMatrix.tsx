import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";

const VARIANTS = [
  "single ticket",
  "multi-ticket purchaser",
  "unassigned group ticket",
  "claimed ticket",
  "already using another ticket",
  "pending incoming transfer",
  "pending outgoing transfer",
  "accepted transfer",
  "refunded / void",
  "checked in",
  "scoring off",
  "leaderboard off",
  "clues off",
  "refund consent pending",
  "offline score pending",
] as const;

type Variant = (typeof VARIANTS)[number];

const COPY: Record<Variant, { title: string; body: string; action?: string }> = {
  "single ticket": {
    title: "Your ticket",
    body: "Admit one · General admission",
    action: "show ticket",
  },
  "multi-ticket purchaser": {
    title: "Your tickets",
    body: "You manage three individual tickets.",
    action: "manage tickets",
  },
  "unassigned group ticket": {
    title: "Who will use this ticket?",
    body: "It has not been assigned yet.",
    action: "use this ticket",
  },
  "claimed ticket": {
    title: "This ticket is yours",
    body: "Your verified identity holds this admission.",
    action: "open ticket",
  },
  "already using another ticket": {
    title: "You are using another ticket",
    body: "Choose whether to switch on this device.",
    action: "use this ticket instead",
  },
  "pending incoming transfer": {
    title: "A ticket is on its way to you",
    body: "Review the transfer before accepting it.",
    action: "review transfer",
  },
  "pending outgoing transfer": {
    title: "Transfer pending",
    body: "You remain the holder until the recipient accepts.",
    action: "cancel transfer",
  },
  "accepted transfer": {
    title: "Transfer complete",
    body: "The new holder has the current ticket authority.",
  },
  "refunded / void": {
    title: "Ticket no longer valid",
    body: "This credential cannot be used for admission.",
  },
  "checked in": { title: "You’re checked in", body: "Admission recorded at 19:42." },
  "scoring off": { title: "Activities", body: "Points are not running for this event." },
  "leaderboard off": { title: "Your score · 120", body: "Public rankings are hidden." },
  "clues off": { title: "Clues", body: "No clues are available right now." },
  "refund consent pending": {
    title: "Refund needs confirmation",
    body: "The other party must agree before this ticket is refunded.",
    action: "review request",
  },
  "offline score pending": {
    title: "12 points pending",
    body: "This device will submit the award when connectivity returns.",
  },
};

export function AttendeePreviewMatrix() {
  const [variant, setVariant] = useState<Variant>("single ticket");
  const [mobile, setMobile] = useState(true);
  const [dark, setDark] = useState(false);
  const preview = COPY[variant];
  return (
    <section aria-labelledby="attendee-preview-heading">
      <div className="border-b theme-border pb-5">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">safe preview</p>
        <h3 id="attendee-preview-heading" className="mt-2 font-serif text-3xl">
          Attendee states
        </h3>
        <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
          Synthetic data only. Controls and links in this preview cannot mutate, send, claim,
          transfer, check in, score, or refund anything.
        </p>
      </div>
      <div className="mt-5 flex flex-wrap gap-4">
        <label className="font-mono text-xs">
          state
          <AppSelect
            value={variant}
            onValueChange={(value) => setVariant(value as Variant)}
            options={VARIANTS.map((item) => ({ value: item, label: item }))}
            ariaLabel="Preview state"
            className="ml-2"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 font-mono text-xs">
          <input
            type="checkbox"
            checked={mobile}
            onChange={(event) => setMobile(event.target.checked)}
          />
          mobile width
        </label>
        <label className="flex min-h-11 items-center gap-2 font-mono text-xs">
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => setDark(event.target.checked)}
          />
          dark theme
        </label>
      </div>
      <div
        className={`mt-6 overflow-auto border theme-border p-4 ${dark ? "dark bg-background text-foreground" : "bg-background text-foreground"}`}
      >
        <div
          className={`${mobile ? "max-w-[24rem]" : "max-w-2xl"} mx-auto border-x theme-border bg-background px-6 py-8`}
        >
          <p className="border-y theme-border py-2 text-center font-mono text-micro font-bold uppercase tracking-widest">
            admin preview · no real actions
          </p>
          <p className="mt-8 font-mono text-micro uppercase tracking-widest theme-muted">
            you · after hours
          </p>
          <h4 className="mt-2 font-serif text-3xl">{preview.title}</h4>
          <p className="mt-3 font-mono text-xs leading-relaxed theme-muted">{preview.body}</p>
          {preview.action ? (
            <button
              type="button"
              disabled
              className="mt-6 min-h-11 border border-foreground px-4 font-mono text-xs opacity-60"
            >
              {preview.action}
            </button>
          ) : null}
          <div className="mt-8 border-t theme-border pt-5">
            <p className="font-mono text-micro theme-muted">Avery Finch · a•••@example.test</p>
            <p className="mt-2 font-mono text-xs">Saturday, 20:00 · Peckham</p>
          </div>
        </div>
      </div>
    </section>
  );
}
