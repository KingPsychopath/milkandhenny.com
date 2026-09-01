import { useEffect } from "react";

import { ATTENDEE_CLAIMS_EVENT, reconcileAttendeeClaims } from "../attendee-claims.client";

const RECONCILE_MS = 5_000;

export function AttendeeClaimReconciler() {
  useEffect(() => {
    let active = true;
    let running = false;
    const reconcile = async () => {
      if (!active || running || !navigator.onLine || document.visibilityState === "hidden") return;
      running = true;
      try {
        await reconcileAttendeeClaims();
      } finally {
        running = false;
      }
    };
    const wake = () => void reconcile();
    void reconcile();
    const timer = window.setInterval(wake, RECONCILE_MS);
    window.addEventListener("online", wake);
    window.addEventListener(ATTENDEE_CLAIMS_EVENT, wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener(ATTENDEE_CLAIMS_EVENT, wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return null;
}
