import { useEffect, useRef, useState, type ReactNode } from "react";

export function GuessComposer({
  disabled,
  message,
  onGuess,
  actions,
  turnLabel,
}: {
  disabled?: boolean;
  message?: string | null;
  onGuess: (word: string) => Promise<boolean>;
  actions?: ReactNode;
  turnLabel?: string;
}) {
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const submit = async () => {
    const submittedWord = word.trim();
    if (!submittedWord || busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    setWord("");
    try {
      const accepted = await onGuess(submittedWord);
      if (!accepted) setWord((current) => current || submittedWord);
    } finally {
      busyRef.current = false;
      setBusy(false);
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    }
  };
  useEffect(() => {
    if (disabled || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    input.current?.focus({ preventScroll: true });
  }, [disabled]);
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
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="send"
          inputMode="text"
          maxLength={32}
          placeholder={disabled ? "watch the ledger" : "guess any word"}
          onFocus={() => setKeyboard(true)}
          onBlur={() => setKeyboard(false)}
          onChange={(event) => setWord(event.target.value.replace(/[^a-zA-Z'-]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Escape") input.current?.blur();
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="submit"
          disabled={disabled || busy || !word.trim()}
          onPointerDown={(event) => {
            if (document.activeElement === input.current) event.preventDefault();
          }}
        >
          {busy ? "scoring…" : "guess"}
        </button>
        <div className="heat-composer-tools">
          <span aria-live="polite">{message ?? turnLabel ?? "lower is hotter"}</span>
          <div className="heat-composer-actions">
            {actions}
            <button
              type="button"
              className="heat-keyboard-toggle"
              onClick={() => {
                if (keyboard) input.current?.blur();
                else input.current?.focus({ preventScroll: true });
              }}
            >
              {keyboard ? "hide keyboard" : "show keyboard"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
