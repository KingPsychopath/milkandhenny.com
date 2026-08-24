import { useRef, useState } from "react";

export function GuessComposer({
  disabled,
  message,
  onGuess,
  turnLabel,
}: {
  disabled?: boolean;
  message?: string | null;
  onGuess: (word: string) => Promise<boolean>;
  turnLabel?: string;
}) {
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!word.trim() || busy || disabled) return;
    setBusy(true);
    const accepted = await onGuess(word);
    if (accepted) setWord("");
    setBusy(false);
  };
  return (
    <form
      className="heat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="heat-composer-inner">
        <label className="sr-only" htmlFor="hot-and-cold-guess">
          Guess a word
        </label>
        <input
          ref={input}
          id="hot-and-cold-guess"
          value={word}
          disabled={disabled || busy}
          autoComplete="off"
          autoCorrect="on"
          enterKeyHint="send"
          maxLength={32}
          placeholder={disabled ? "watch the ledger" : "guess any word"}
          onFocus={() => setKeyboard(true)}
          onBlur={() => setKeyboard(false)}
          onChange={(event) => setWord(event.target.value.replace(/[^a-zA-Z'-]/g, ""))}
        />
        <button type="submit" disabled={disabled || busy || !word.trim()}>
          {busy ? "scoring…" : "guess"}
        </button>
        <div className="heat-composer-tools">
          <span aria-live="polite">{message ?? turnLabel ?? "lower is hotter"}</span>
          <button
            type="button"
            onClick={() => {
              if (keyboard) input.current?.blur();
              else input.current?.focus();
            }}
          >
            {keyboard ? "hide keyboard" : "show keyboard"}
          </button>
        </div>
      </div>
    </form>
  );
}
