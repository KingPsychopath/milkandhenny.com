import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWebHaptics } from "web-haptics/react";

const RECEIPT_DURATION_MS = 1_600;

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
  const submitButton = useRef<HTMLButtonElement>(null);
  const wordRef = useRef(word);
  const activeWord = useRef<string | null>(null);
  const queue = useRef<string[]>([]);
  const processing = useRef(false);
  const mounted = useRef(true);
  const retainFocusUntil = useRef(0);
  const pendingKeyboardCommit = useRef<{ word: string; expiresAt: number } | null>(null);
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
          requestAnimationFrame(() => {
            if (document.activeElement === input.current && wordRef.current === submittedWord)
              input.current?.select();
          });
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
    pendingKeyboardCommit.current = {
      word: queuedWord,
      expiresAt: Date.now() + 750,
    };
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
    const dismissKeyboardOutsideGuessing = (event: PointerEvent) => {
      if (navigator.maxTouchPoints === 0 || document.activeElement !== input.current) return;
      const target = event.target;
      if (
        !(target instanceof Node) ||
        target === input.current ||
        submitButton.current?.contains(target)
      )
        return;
      retainFocusUntil.current = 0;
      input.current?.blur();
    };
    document.addEventListener("pointerdown", dismissKeyboardOutsideGuessing, true);
    return () => document.removeEventListener("pointerdown", dismissKeyboardOutsideGuessing, true);
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
    }, RECEIPT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [visibleReceipt]);
  const actionableMessage = localMessage ?? message;
  const displayedReceipt = actionableMessage ? null : visibleReceipt;
  const statusMessage = actionableMessage ?? turnLabel ?? "lower is hotter";
  return (
    <form
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
            const nextWord = event.target.value;
            const pendingCommit = pendingKeyboardCommit.current;
            if (
              pendingCommit &&
              Date.now() <= pendingCommit.expiresAt &&
              !wordRef.current &&
              (!nextWord.trim() || nextWord.trim().toLocaleLowerCase() === pendingCommit.word)
            ) {
              event.currentTarget.value = "";
              return;
            }
            pendingKeyboardCommit.current = null;
            wordRef.current = nextWord;
            setWord(nextWord);
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
          ref={submitButton}
          type="submit"
          disabled={disabled || (!continuous && busy)}
          onPointerDown={(event) => {
            if (document.activeElement === input.current) event.preventDefault();
          }}
        >
          guess
        </button>
        <div className="heat-composer-tools">
          <output
            id="hot-and-cold-guess-message"
            className="heat-composer-status"
            data-status={displayedReceipt ? "receipt" : actionableMessage ? "error" : "guidance"}
            aria-live="polite"
            aria-atomic="true"
          >
            {displayedReceipt ? (
              <>
                <span
                  aria-hidden="true"
                  className="heat-composer-guidance heat-composer-guidance-outgoing"
                >
                  {statusMessage}
                </span>
                <span key={displayedReceipt.id} className="heat-guess-receipt">
                  {displayedReceipt.label}
                </span>
              </>
            ) : (
              <span className="heat-composer-guidance">{statusMessage}</span>
            )}
          </output>
          <div className="heat-composer-controls">
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
