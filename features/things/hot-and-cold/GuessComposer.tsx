import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useWebHaptics } from "web-haptics/react";
import { useMobileKeyboardSession } from "@/hooks/useMobileKeyboardSession";

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
  continuous = false,
  keyboardSurfaceRef,
  turnLabel,
}: {
  disabled?: boolean;
  message?: string | null;
  onGuess: (word: string) => Promise<boolean>;
  actions?: ReactNode;
  continuous?: boolean;
  keyboardSurfaceRef: RefObject<HTMLDivElement | null>;
  turnLabel?: string;
}) {
  const haptics = useWebHaptics();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const composer = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const wordRef = useRef(word);
  const activeWord = useRef<string | null>(null);
  const queue = useRef<string[]>([]);
  const processing = useRef(false);
  const mounted = useRef(true);
  const retainFocusUntil = useRef(0);
  const disabledRef = useRef(disabled);
  const onGuessRef = useRef(onGuess);
  const { dismissKeyboard } = useMobileKeyboardSession({
    dockRef: composer,
    inputRef: input,
    restoreScrollOnClose: true,
    surfaceRef: keyboardSurfaceRef,
    onSessionOpen: ({ input: activeInput, surface }) => {
      if (document.activeElement !== activeInput) return;
      const source = surface.querySelector<HTMLElement>(".heat-source");
      const hottest = surface.querySelector<HTMLElement>(".heat-ledger > li:first-child");
      if (!source || !hottest) return;
      const delta = hottest.getBoundingClientRect().top - source.getBoundingClientRect().bottom;
      if (Math.abs(delta) > 2) window.scrollBy({ top: delta, behavior: "auto" });
    },
  });
  disabledRef.current = disabled;
  onGuessRef.current = onGuess;
  wordRef.current = word;
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
  const updatePendingCount = () => {
    if (mounted.current) setPendingCount(queue.current.length + (activeWord.current ? 1 : 0));
  };
  const drainQueue = async () => {
    if (processing.current) return;
    processing.current = true;
    if (mounted.current) setBusy(true);
    while (mounted.current && !disabledRef.current && queue.current.length > 0) {
      const submittedWord = queue.current.shift();
      if (!submittedWord) continue;
      activeWord.current = submittedWord;
      updatePendingCount();
      let accepted = false;
      try {
        accepted = await onGuessRef.current(submittedWord);
      } catch {
        accepted = false;
      }
      activeWord.current = null;
      updatePendingCount();
      if (!mounted.current) return;
      if (!accepted) {
        if (queue.current.length === 0 && !wordRef.current) {
          wordRef.current = submittedWord;
          setWord(submittedWord);
          reject();
        } else void haptics.trigger("nudge");
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (disabledRef.current) queue.current = [];
    processing.current = false;
    activeWord.current = null;
    if (!mounted.current) return;
    setBusy(false);
    setPendingCount(0);
    if (!disabledRef.current && matchMedia("(hover: hover) and (pointer: fine)").matches)
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };
  const retainMobileFocus = () => {
    if (!continuous || disabled || navigator.maxTouchPoints === 0) return;
    retainFocusUntil.current = Date.now() + 1_200;
    input.current?.focus({ preventScroll: true });
  };
  const submit = () => {
    retainMobileFocus();
    const submittedWord = word.trim();
    if (!submittedWord || (!continuous && processing.current) || disabled) return;
    const invalidMessage = localGuessError(submittedWord);
    if (invalidMessage) {
      reject(invalidMessage);
      return;
    }
    const queuedWord = submittedWord.toLocaleLowerCase();
    if (
      activeWord.current?.toLocaleLowerCase() === queuedWord ||
      queue.current.some((pending) => pending.toLocaleLowerCase() === queuedWord)
    ) {
      reject("already waiting to score");
      return;
    }
    queue.current.push(submittedWord);
    wordRef.current = "";
    setWord("");
    setRejected(false);
    setLocalMessage(null);
    updatePendingCount();
    void drainQueue();
  };
  useEffect(() => {
    if (disabled || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    input.current?.focus({ preventScroll: true });
  }, [disabled]);
  useEffect(() => {
    if (!continuous) return;
    const allowIntentionalBlur = () => {
      retainFocusUntil.current = 0;
    };
    document.addEventListener("pointerdown", allowIntentionalBlur, true);
    return () => document.removeEventListener("pointerdown", allowIntentionalBlur, true);
  }, [continuous]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queue.current = [];
    };
  }, []);
  useEffect(() => {
    if (!disabled) return;
    queue.current = [];
    updatePendingCount();
  }, [disabled]);
  const progressMessage =
    continuous && busy
      ? pendingCount > 1
        ? `${pendingCount} guesses queued`
        : "scoring · keep typing"
      : null;
  return (
    <form
      ref={composer}
      className="heat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
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
          aria-busy={busy || undefined}
          aria-invalid={rejected || undefined}
          aria-describedby="hot-and-cold-guess-message"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="send"
          inputMode="text"
          maxLength={32}
          spellCheck={false}
          placeholder={disabled ? "watch the ledger" : "guess any word"}
          onBlur={(event) => {
            if (
              !continuous ||
              disabled ||
              navigator.maxTouchPoints === 0 ||
              event.relatedTarget ||
              Date.now() > retainFocusUntil.current
            )
              return;
            event.currentTarget.focus({ preventScroll: true });
          }}
          onChange={(event) => {
            wordRef.current = event.target.value;
            setWord(event.target.value);
            setRejected(false);
            setLocalMessage(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") dismissKeyboard();
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          disabled={disabled || (!continuous && busy) || !word.trim()}
          onPointerDown={(event) => {
            if (document.activeElement === input.current) event.preventDefault();
          }}
        >
          {busy
            ? continuous && word.trim()
              ? "queue"
              : pendingCount > 1
                ? `${pendingCount} queued`
                : "scoring…"
            : "guess"}
        </button>
        <div className="heat-composer-tools">
          <span id="hot-and-cold-guess-message" aria-live="polite">
            {localMessage ?? progressMessage ?? message ?? turnLabel ?? "lower is hotter"}
          </span>
          <div className="heat-composer-controls">
            <button
              type="button"
              className="heat-keyboard-dismiss"
              aria-label="Hide keyboard"
              onPointerDown={(event) => {
                retainFocusUntil.current = 0;
                event.preventDefault();
              }}
              onClick={() => {
                retainFocusUntil.current = 0;
                dismissKeyboard();
              }}
            >
              hide keys
            </button>
            {actions ? (
              <fieldset className="heat-composer-actions" disabled={busy}>
                <legend className="sr-only">Game actions</legend>
                {actions}
              </fieldset>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}
