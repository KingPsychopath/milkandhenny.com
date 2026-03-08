"use client";

import { useSyncExternalStore } from "react";

function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export { useHasMounted };
