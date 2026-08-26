import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWebHaptics } from "web-haptics/react";

function localGuessError(word: string) {
  const trimmed = word.trim();
  if (trimmed.length < 2) return "try at least two letters";
  if (/\d/.test(trimmed)) return "letters only · no numbers";
  if (/\s/.test(trimmed)) return "one word at a time";
  if (!/^[\p{L}’'-]+$/u.test(trimmed)) return "letters only · one word";
  return null;
}

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
  const haptics = useWebHaptics();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const reject = (nextMessage?: string) => {
    setRejected(true);
    if (nextMessage) setLocalMessage(nextMessage);
    void haptics.trigger("nudge");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    input.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-0.42rem)" },
        { transform: "translateX(0.32rem)" },
        { transform: "translateX(-0.2rem)" },
        { transform: "translateX(0.1rem)" },
        { transform: "translateX(0)" },
      ],
      { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  };
  const submit = async () => {
    const submittedWord = word.trim();
    if (!submittedWord || busyRef.current || disabled) return;
    const invalidMessage = localGuessError(submittedWord);
    if (invalidMessage) {
      reject(invalidMessage);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setRejected(false);
    setLocalMessage(null);
    try {
      const accepted = await onGuess(submittedWord);
      if (accepted) setWord("");
      else reject();
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
          readOnly={busy}
          aria-busy={busy || undefined}
          aria-invalid={rejected || undefined}
          aria-describedby="hot-and-cold-guess-message"
          autoComplete="off"
          enterKeyHint="send"
          inputMode="text"
          maxLength={32}
          placeholder={disabled ? "watch the ledger" : "guess any word"}
          onChange={(event) => {
            setWord(event.target.value);
            setRejected(false);
            setLocalMessage(null);
          }}
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
          <span id="hot-and-cold-guess-message" aria-live="polite">
            {localMessage ?? message ?? turnLabel ?? "lower is hotter"}
          </span>
          {actions ? <div className="heat-composer-actions">{actions}</div> : null}
        </div>
      </div>
    </form>
  );
}
