import { useEffect, useSyncExternalStore } from "react";

const owners = new Map<string, boolean>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function isSafe() {
  return [...owners.values()].every(Boolean);
}

export function useUpdateReloadSafety(owner: string, safe: boolean) {
  useEffect(() => {
    owners.set(owner, safe);
    emit();
    return () => {
      owners.delete(owner);
      emit();
    };
  }, [owner, safe]);
}

export function useIsUpdateReloadSafe() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isSafe,
    () => true,
  );
}
