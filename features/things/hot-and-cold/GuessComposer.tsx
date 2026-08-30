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

export interface GuessReceipt {
  id: string;
  label: string;
}

export function GuessComposer({
  disabled,
  message,
  receipt,
  onGuess,
  onMessageClear,
  actions,
  continuous = false,
  turnLabel,
}: {
  disabled?: boolean;
  message?: string | null;
  receipt?: GuessReceipt | null;
  onGuess: (word: string) => Promise<boolean>;
  onMessageClear?: () => void;
  actions?: ReactNode;
  continuous?: boolean;
  turnLabel?: string;
}) {
  const haptics = useWebHaptics();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [visibleReceipt, setVisibleReceipt] = useState<GuessReceipt | null>(null);
  const visibleReceiptRef = useRef<GuessReceipt | null>(null);
  const receiptQueue = useRef<GuessReceipt[]>([]);
  const queuedReceiptIds = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const wordRef = useRef(word);
  const activeWord = useRef<string | null>(null);
  const queue = useRef<string[]>([]);
  const processing = useRef(false);
  const mounted = useRef(true);
  const retainFocusUntil = useRef(0);
  const disabledRef = useRef(disabled);
  const onGuessRef = useRef(onGuess);
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
  const drainQueue = async () => {
    if (processing.current) return;
    processing.current = true;
    if (mounted.current) setBusy(true);
    while (mounted.current && !disabledRef.current && queue.current.length > 0) {
      const submittedWord = queue.current.shift();
      if (!submittedWord) continue;
      activeWord.current = submittedWord;
      let accepted = false;
      try {
        accepted = await onGuessRef.current(submittedWord);
      } catch {
        accepted = false;
      }
      activeWord.current = null;
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
  }, [disabled]);
  const receiptId = receipt?.id;
  const receiptLabel = receipt?.label;
  useEffect(() => {
    if (!receiptId || !receiptLabel || queuedReceiptIds.current.has(receiptId)) return;
    const nextReceipt = { id: receiptId, label: receiptLabel };
    queuedReceiptIds.current.add(receiptId);
    if (visibleReceiptRef.current) {
      receiptQueue.current.push(nextReceipt);
      return;
    }
    visibleReceiptRef.current = nextReceipt;
    setVisibleReceipt(nextReceipt);
  }, [receiptId, receiptLabel]);
  useEffect(() => {
    if (!visibleReceipt) return;
    const timer = setTimeout(() => {
      const nextReceipt = receiptQueue.current.shift() ?? null;
      visibleReceiptRef.current = nextReceipt;
      setVisibleReceipt(nextReceipt);
    }, 2_800);
    return () => clearTimeout(timer);
  }, [visibleReceipt]);
  return (
    <form
      className="heat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {visibleReceipt ? (
        <output
          key={visibleReceipt.id}
          className="heat-guess-receipt"
          aria-live="polite"
          aria-atomic="true"
        >
          {visibleReceipt.label}
        </output>
      ) : null}
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
            onMessageClear?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") input.current?.blur();
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          disabled={disabled || (!continuous && busy)}
          onPointerDown={(event) => {
            if (document.activeElement === input.current) event.preventDefault();
          }}
        >
          guess
        </button>
        <div className="heat-composer-tools">
          <span id="hot-and-cold-guess-message" aria-live="polite" aria-atomic="true">
            {localMessage ?? message ?? turnLabel ?? "lower is hotter"}
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
                input.current?.blur();
              }}
            >
              hide keys
            </button>
            {actions ? (
              <fieldset className="heat-composer-actions" disabled={busy && !continuous}>
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
