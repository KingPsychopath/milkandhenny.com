import { useId, useRef, useState } from "react";
import {
  GAME_POOL_SETTINGS_BUNDLE_MAX_BYTES,
  gamePoolSettingsBundle,
  gamePoolSettingsBundleFilename,
  parseGamePoolSettingsBundle,
  recommendedGamePoolSettingsBundle,
  serializeGamePoolSettingsBundle,
  type GamePoolSettingsBundle,
} from "@/features/things/pool/preset-bundle";
import { parseGameSettingsDocument } from "@/features/things/shared/game-settings";
import type { GamePoolEntrance } from "@/features/things/pool/types";
import { AdminStatus, adminToneBorderClass } from "./AdminStatus";

export function GamePoolSettingsTransfer({
  entrance,
  draft,
  disabled,
  onApply,
  onCreate,
  onError,
  onStatus,
}: {
  entrance: GamePoolEntrance;
  draft: GamePoolEntrance;
  disabled: boolean;
  onApply: (bundle: GamePoolSettingsBundle) => void;
  onCreate: (bundle: GamePoolSettingsBundle) => Promise<void>;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const textareaId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<GamePoolSettingsBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const currentBundle = () => parseGamePoolSettingsBundle(gamePoolSettingsBundle(draft));
  const receive = (value: string) => {
    setText(value);
    if (!value.trim()) {
      setParsed(null);
      setParseError(null);
      return;
    }
    try {
      try {
        setParsed(parseGamePoolSettingsBundle(value));
      } catch {
        const gameSettings = parseGameSettingsDocument(value);
        if (gameSettings.game !== entrance.game)
          throw new Error(`These settings are for ${gameSettings.game}, not ${entrance.game}.`);
        setParsed({ ...currentBundle(), gameSettings });
      }
      setParseError(null);
    } catch (error) {
      setParsed(null);
      setParseError(error instanceof Error ? error.message : "The settings bundle is not valid.");
    }
  };

  const copy = async () => {
    let value: string;
    try {
      value = serializeGamePoolSettingsBundle(currentBundle());
    } catch (error) {
      onError(error instanceof Error ? error.message : "The settings could not be exported.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      onStatus("Settings copied. Entrance links and room data were not included.");
    } catch {
      setOpen(true);
      receive(value);
      onError("Clipboard access was not available. Copy the JSON shown below.");
    }
  };

  const paste = async () => {
    setOpen(true);
    try {
      receive(await navigator.clipboard.readText());
    } catch {
      onError("Clipboard access was not available. Paste the JSON into the field.");
      document.getElementById(textareaId)?.focus();
    }
  };

  const download = () => {
    try {
      const bundle = currentBundle();
      const url = URL.createObjectURL(
        new Blob([serializeGamePoolSettingsBundle(bundle)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = gamePoolSettingsBundleFilename(bundle);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      onStatus("Settings file downloaded.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "The settings could not be exported.");
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setOpen(true);
    if (file.size > GAME_POOL_SETTINGS_BUNDLE_MAX_BYTES) {
      receive("");
      setParseError("The settings file is too large.");
      return;
    }
    try {
      receive(await file.text());
    } catch {
      receive("");
      setParseError("The settings file could not be read.");
    }
  };

  const reset = () => {
    onApply(recommendedGamePoolSettingsBundle(entrance.game, draft.label));
    onStatus("Recommended settings loaded into the form. Save when ready.");
  };

  const duplicate = () => {
    try {
      const bundle = currentBundle();
      void onCreate({ ...bundle, label: `${bundle.label} copy`.slice(0, 80) });
    } catch (error) {
      onError(error instanceof Error ? error.message : "The settings could not be duplicated.");
    }
  };

  return (
    <section className="border-t theme-border pt-4" aria-labelledby={`${textareaId}-title`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p id={`${textareaId}-title`} className="font-mono text-xs theme-muted">
          portable settings
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void copy()}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          copy JSON
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={download}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          download
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void paste()}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          paste JSON
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          upload file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            void loadFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={duplicate}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          duplicate with new QR
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={reset}
          className="min-h-11 font-mono text-xs underline disabled:opacity-40"
        >
          reset to recommended
        </button>
      </div>
      <p className="font-mono text-micro leading-relaxed theme-faint">
        Settings never include QR links, tokens, players, rooms, or game-night history.
      </p>

      {open ? (
        <div className="mt-4 space-y-4">
          <label htmlFor={textareaId} className="block font-mono text-xs theme-muted">
            settings JSON
          </label>
          <textarea
            id={textareaId}
            value={text}
            rows={12}
            maxLength={GAME_POOL_SETTINGS_BUNDLE_MAX_BYTES}
            spellCheck={false}
            aria-invalid={Boolean(parseError) || undefined}
            aria-describedby={parseError ? `${textareaId}-error` : undefined}
            onChange={(event) => receive(event.target.value)}
            className="w-full resize-y border theme-border bg-transparent p-3 font-mono text-xs leading-relaxed text-[var(--foreground)]"
          />
          {parseError ? (
            <p
              id={`${textareaId}-error`}
              role="alert"
              className={`border-l-2 pl-3 font-mono text-xs ${adminToneBorderClass("danger")}`}
            >
              {parseError}
            </p>
          ) : null}
          {parsed ? (
            <div className="border-t theme-border pt-4">
              <p className="font-serif text-lg font-semibold">{parsed.label}</p>
              <AdminStatus tone="positive" className="mt-1 font-mono text-xs">
                settings bundle valid
              </AdminStatus>
              <p className="mt-1 font-mono text-xs theme-muted">
                {parsed.game} · {parsed.targetSize} per room ·{" "}
                {parsed.admission.autoJoin ? "fast repeat joins" : "confirm every join"}
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                {parsed.game === entrance.game ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onApply(parsed);
                      onStatus("Imported settings loaded into the form. Save when ready.");
                    }}
                    className="min-h-11 rounded-full border theme-border px-5 font-mono text-xs disabled:opacity-40"
                  >
                    load into this entrance
                  </button>
                ) : (
                  <AdminStatus tone="attention" className="font-mono text-xs">
                    This entrance uses {entrance.game}. Create a new entrance to use this{" "}
                    {parsed.game} bundle.
                  </AdminStatus>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void onCreate(parsed)}
                  className="min-h-11 rounded-full bg-[var(--foreground)] px-5 font-mono text-xs text-[var(--background)] disabled:opacity-40"
                >
                  create new entrance
                </button>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 font-mono text-xs underline"
          >
            close JSON editor
          </button>
        </div>
      ) : null}
    </section>
  );
}
