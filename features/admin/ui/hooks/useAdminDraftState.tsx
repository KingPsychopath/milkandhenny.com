import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useBlocker } from "@tanstack/react-router";
import { useActionDialog } from "@/hooks/useActionDialog";

const PREFIX = "mah:admin-draft:v1:";
const MAX_AGE = 12 * 60 * 60 * 1000;
const MAX_BYTES = 128 * 1024;
type DraftStatus = { dirty: boolean; recovered: boolean; unavailable: boolean };
const DraftContext = createContext<{
  scope: string;
  register: (key: string, status: DraftStatus | null) => void;
} | null>(null);

export function AdminDraftProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, DraftStatus>>({});
  const { confirm, dialog } = useActionDialog();
  const register = useCallback(
    (key: string, status: DraftStatus | null) =>
      setDrafts((current) => {
        if (JSON.stringify(current[key]) === JSON.stringify(status ?? undefined)) return current;
        const next = { ...current };
        if (status) next[key] = status;
        else delete next[key];
        return next;
      }),
    [],
  );
  const dirty = Object.values(drafts).some((draft) => draft.dirty);
  const unavailable = Object.values(drafts).some((draft) => draft.unavailable);
  const recovered = Object.values(drafts).some((draft) => draft.recovered);
  useBlocker({
    enableBeforeUnload: dirty,
    shouldBlockFn: async ({ current, next }) => {
      if (!dirty || (!unavailable && current.pathname === next.pathname)) return false;
      return !(await confirm({
        title: "Leave with unfinished edits?",
        description: unavailable
          ? "Draft recovery is unavailable in this browser. Copy your edits before leaving."
          : "Your unfinished edits are kept in this tab for up to 12 hours. Return to the editor to continue.",
        confirmLabel: "leave editor",
        cancelLabel: "keep editing",
      }));
    },
  });
  return (
    <DraftContext.Provider value={{ scope, register }}>
      {recovered || unavailable ? (
        <p role="status" className="mx-auto max-w-7xl px-4 pt-4 font-mono text-xs theme-muted">
          {unavailable
            ? "Draft recovery is unavailable. Keep this page open or copy your edits before leaving."
            : "Unfinished edits recovered in this tab. Save or cancel in the editor when ready."}
        </p>
      ) : null}
      {children}
      {dialog}
    </DraftContext.Provider>
  );
}

/** Tab-scoped working copies contain content only, never credentials. Saving the initial value clears recovery. */
export function useAdminDraftState<T>(
  key: string,
  initialValue: T,
  isDirty?: (value: T) => boolean,
): [T, Dispatch<SetStateAction<T>>, (saved?: T) => void] {
  const context = useContext(DraftContext);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [value, setValue] = useState(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const storageKey = context ? `${PREFIX}${context.scope}:${key}` : null;
  const register = context?.register;
  const dirty = isDirty ? isDirty(value) : JSON.stringify(value) !== JSON.stringify(savedValue);
  useEffect(() => {
    if (storageKey) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw && raw.length <= MAX_BYTES) {
          const saved = JSON.parse(raw);
          if (saved.expiresAt > Date.now() && Object.hasOwn(saved, "value")) {
            setValue(saved.value);
            setRecovered(true);
          } else sessionStorage.removeItem(storageKey);
        }
      } catch {
        setUnavailable(true);
      }
    }
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated || !storageKey) return;
    try {
      if (!dirty) {
        sessionStorage.removeItem(storageKey);
        setRecovered(false);
      } else {
        const raw = JSON.stringify({ expiresAt: Date.now() + MAX_AGE, value });
        if (raw.length > MAX_BYTES) throw new Error("Draft too large");
        sessionStorage.setItem(storageKey, raw);
      }
    } catch {
      setUnavailable(true);
    }
  }, [dirty, hydrated, storageKey, value]);
  useEffect(() => {
    register?.(key, { dirty, recovered, unavailable });
    return () => register?.(key, null);
  }, [dirty, key, recovered, register, unavailable]);
  return [value, setValue, (saved = value) => setSavedValue(saved)];
}
