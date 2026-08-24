import { useId, useRef, useState } from "react";
import {
  parseEmbeddedGameSettingsDocument,
  serializeGameSettingsDocument,
  type GameSettings,
  type GameSettingsDocument,
} from "./game-settings";

const MAX_SETTINGS_BYTES = 64 * 1024;

export function GameSettingsTransfer({
  document: settingsDocument,
  onApply,
}: {
  document: GameSettingsDocument;
  onApply: (settings: GameSettings) => void;
}) {
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<GameSettingsDocument | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const receive = (value: string) => {
    setText(value);
    setMessage(null);
    if (!value.trim()) {
      setParsed(null);
      return;
    }
    if (new TextEncoder().encode(value).byteLength > MAX_SETTINGS_BYTES) {
      setParsed(null);
      setMessage("The settings file is too large.");
      return;
    }
    try {
      const next = parseEmbeddedGameSettingsDocument(value);
      if (next.game !== settingsDocument.game)
        throw new Error(`These settings are for ${next.game}, not ${settingsDocument.game}.`);
      setParsed(next);
    } catch (error) {
      setParsed(null);
      setMessage(error instanceof Error ? error.message : "The settings are not valid.");
    }
  };

  const copy = async () => {
    const value = serializeGameSettingsDocument(settingsDocument);
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Game settings copied.");
    } catch {
      setOpen(true);
      receive(value);
      setMessage("Copy the JSON shown below.");
    }
  };

  const paste = async () => {
    setOpen(true);
    try {
      receive(await navigator.clipboard.readText());
    } catch {
      setMessage("Paste the game or pool settings JSON below.");
      document.getElementById(fieldId)?.focus();
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setOpen(true);
    if (file.size > MAX_SETTINGS_BYTES) {
      receive("");
      setMessage("The settings file is too large.");
      return;
    }
    try {
      receive(await file.text());
    } catch {
      setMessage("The settings file could not be read.");
    }
  };

  return (
    <details className="mt-5 border-t border-current/15 pt-4" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        className="min-h-11 cursor-pointer font-mono text-xs opacity-60"
      >
        import or export game settings
      </summary>
      <div className="space-y-3 pb-2">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <button
            type="button"
            onClick={() => void copy()}
            className="min-h-11 font-mono text-xs underline"
          >
            copy JSON
          </button>
          <button
            type="button"
            onClick={() => void paste()}
            className="min-h-11 font-mono text-xs underline"
          >
            paste JSON
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="min-h-11 font-mono text-xs underline"
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
        </div>
        <label htmlFor={fieldId} className="block font-mono text-xs opacity-60">
          settings JSON
        </label>
        <textarea
          id={fieldId}
          value={text}
          rows={8}
          maxLength={MAX_SETTINGS_BYTES}
          spellCheck={false}
          aria-invalid={Boolean(message && !parsed) || undefined}
          onChange={(event) => receive(event.target.value)}
          className="w-full resize-y border border-current/20 bg-transparent p-3 font-mono text-xs leading-relaxed"
        />
        {message ? (
          <p role="status" className="font-mono text-xs opacity-60">
            {message}
          </p>
        ) : null}
        {parsed ? (
          <button
            type="button"
            onClick={() => {
              onApply(parsed.settings);
              setMessage("Game settings applied and remembered on this device.");
            }}
            className="min-h-11 rounded-full border border-current/30 px-5 font-mono text-xs"
          >
            apply to this game
          </button>
        ) : null}
      </div>
    </details>
  );
}
