import { useEffect, useMemo, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { StatusNotice } from "@/components/StatusNotice";
import { useQrCode } from "@/hooks/useQrCode";
import { mintStaffAwardClaimFn } from "../staff-scoring.functions";
import type { PageData } from "./useStaffScoringController";

type IssuedClaim = {
  claimPath: string;
  activityName: string;
  points: number;
  expiresAt: string;
};

export function StaffQuickAwardQr({ data, token }: { data: PageData; token: string }) {
  const fixedActivities = useMemo(
    () =>
      data.activities.filter(
        (activity) =>
          (activity.rule.mode === "fixed" && (activity.rule.fixedPoints ?? 0) > 0) ||
          (activity.rule.mode === "participation" && (activity.rule.participationPoints ?? 0) > 0),
      ),
    [data.activities],
  );
  const [activityId, setActivityId] = useState(fixedActivities[0]?.id ?? "");
  const [customPoints, setCustomPoints] = useState(1);
  const [note, setNote] = useState("");
  const [issued, setIssued] = useState<IssuedClaim>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(0);
  const url =
    issued && typeof window !== "undefined" ? `${window.location.origin}${issued.claimPath}` : null;
  const { dataUrl, failed } = useQrCode(url, 420);

  useEffect(() => {
    if (!issued) {
      setRemaining(0);
      return;
    }
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((Date.parse(issued.expiresAt) - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [issued]);

  async function mint(selectedActivityId: string, points?: number) {
    setBusy(true);
    setError("");
    setIssued(undefined);
    const result = await mintStaffAwardClaimFn({
      data: {
        eventSlug: data.eventSlug,
        token,
        activityId: selectedActivityId,
        points,
        note: points === undefined ? undefined : note.trim(),
        expiresInSeconds: 60,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIssued(result.value);
  }

  if (fixedActivities.length === 0 && !data.canFreeform) return null;
  return (
    <section aria-labelledby="award-qr-heading" className="mt-7 border-y theme-border py-5">
      <h3 id="award-qr-heading" className="font-serif text-xl">
        One-use award QR
      </h3>
      <p className="mt-2 font-mono text-xs theme-muted">
        Choose a configured award, then hold up the QR. The first eligible ticket gets it; the code
        expires after 60 seconds.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {fixedActivities.map((activity, index) => {
          const points =
            activity.rule.mode === "participation"
              ? (activity.rule.participationPoints ?? 0)
              : (activity.rule.fixedPoints ?? 0);
          return (
            <button
              key={activity.id}
              type="button"
              disabled={busy}
              onClick={() => void mint(activity.id)}
              className={`mh-action min-h-16 justify-between text-left disabled:opacity-50 ${index === 0 ? "mh-action--primary" : "mh-action--secondary"}`}
            >
              <span className="font-serif text-lg">{activity.name}</span>
              <span className="font-mono text-sm">+{points}</span>
            </button>
          );
        })}
      </div>

      {data.canFreeform ? (
        <details className="mt-4 border-t theme-border pt-2">
          <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
            custom QR award
          </summary>
          <div className="space-y-3 py-2">
            <label className="block font-mono text-xs">
              activity
              <AppSelect
                value={activityId}
                onValueChange={setActivityId}
                options={data.activities.map((activity) => ({
                  value: activity.id,
                  label: activity.name,
                }))}
                variant="field"
                ariaLabel="Custom QR activity"
                className="mt-2"
              />
            </label>
            <label className="block font-mono text-xs">
              points
              <input
                type="number"
                min={1}
                max={data.maxPointsPerAward}
                step={1}
                value={customPoints}
                onChange={(event) => setCustomPoints(Number(event.target.value))}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>
            <label className="block font-mono text-xs">
              reason
              <input
                required
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !activityId ||
                !Number.isInteger(customPoints) ||
                customPoints < 1 ||
                customPoints > data.maxPointsPerAward ||
                !note.trim()
              }
              onClick={() => void mint(activityId, customPoints)}
              className="mh-action mh-action--secondary disabled:opacity-50"
            >
              show custom QR
            </button>
          </div>
        </details>
      ) : null}

      {error ? (
        <StatusNotice tone="danger" label="QR unavailable" className="mt-4">
          {error}
        </StatusNotice>
      ) : null}
      {issued ? (
        <div className="mt-5 border-t theme-border pt-5 text-center" aria-live="polite">
          <p className="font-serif text-2xl">
            {issued.activityName} · +{issued.points}
          </p>
          <p
            className={`mt-1 font-mono text-xs ${remaining > 10 ? "text-[var(--status-positive)]" : remaining > 0 ? "text-[var(--status-attention)]" : "text-[var(--status-danger)]"}`}
          >
            {remaining > 0 ? `${remaining} seconds left` : "expired"}
          </p>
          {remaining > 0 && dataUrl ? (
            <>
              <img
                src={dataUrl}
                alt={`Single-use QR for ${issued.points} points`}
                className="mx-auto mt-4 aspect-square w-full max-w-xs bg-white p-3"
              />
              <a
                href={url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-11 items-center font-mono text-xs underline"
              >
                open claim link
              </a>
              <button
                type="button"
                onClick={() => setIssued(undefined)}
                className="mx-auto mt-2 mh-action mh-action--quiet"
              >
                close QR
              </button>
            </>
          ) : failed ? (
            <p className="mt-4 font-mono text-xs">QR unavailable. Create another award.</p>
          ) : (
            <button
              type="button"
              onClick={() => setIssued(undefined)}
              className="mx-auto mt-3 mh-action mh-action--secondary"
            >
              choose another award
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
