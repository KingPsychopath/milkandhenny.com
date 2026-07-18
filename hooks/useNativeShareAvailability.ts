"use client";

import { useEffect, useState } from "react";

import { canUseNativeShare } from "@/lib/client/share";

export function useNativeShareAvailability(options: { coarsePointerOnly?: boolean } = {}) {
  const coarsePointerOnly = options.coarsePointerOnly ?? false;
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(canUseNativeShare({ coarsePointerOnly }));
  }, [coarsePointerOnly]);

  return available;
}
