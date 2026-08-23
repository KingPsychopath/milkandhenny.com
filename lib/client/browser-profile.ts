"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getStorageKey } from "@/lib/shared/storage-keys";
import { getStored, setStored } from "./storage";

/**
 * Shared, editable defaults for fields about the person using this browser.
 * Add future fields here with an explicit normaliser and an empty default; do not turn the profile
 * into an untyped store for feature state or credentials.
 */
export interface BrowserProfile {
  name: string;
  email: string;
}

const EMPTY_PROFILE: BrowserProfile = { name: "", email: "" };
const PROFILE_CHANGE_EVENT = "mah:browser-profile-change";
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;

function normaliseName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : "";
}

function normaliseEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function readBrowserProfile(): BrowserProfile {
  try {
    const value: unknown = JSON.parse(getStored("browserProfile") ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_PROFILE;
    return {
      name: normaliseName("name" in value ? value.name : undefined),
      email: normaliseEmail("email" in value ? value.email : undefined),
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

/**
 * Saves convenience defaults for this browser. These values are never authentication and callers
 * must only remember them after a successful user action.
 */
export function rememberBrowserProfile(fields: Partial<BrowserProfile>): BrowserProfile {
  const current = readBrowserProfile();
  const name = fields.name === undefined ? current.name : normaliseName(fields.name);
  const email = fields.email === undefined ? current.email : normaliseEmail(fields.email);
  const next = { name: name || current.name, email: email || current.email };

  if (setStored("browserProfile", JSON.stringify(next))) {
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT));
  }
  return next;
}

export function useBrowserProfile() {
  const [profile, setProfile] = useState<BrowserProfile>(EMPTY_PROFILE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const sync = () => setProfile(readBrowserProfile());
    const syncStorage = (event: StorageEvent) => {
      if (event.key === getStorageKey("browserProfile")) sync();
    };

    sync();
    setLoaded(true);
    window.addEventListener(PROFILE_CHANGE_EVENT, sync);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener(PROFILE_CHANGE_EVENT, sync);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  const remember = useCallback((fields: Partial<BrowserProfile>) => {
    const next = rememberBrowserProfile(fields);
    setProfile(next);
  }, []);

  return { loaded, profile, remember };
}

/** Editable form defaults which do not overwrite a field after the person starts typing. */
export function useBrowserProfileForm({ maxNameLength = MAX_NAME_LENGTH } = {}) {
  const { loaded, profile, remember } = useBrowserProfile();
  const [name, setNameState] = useState("");
  const [email, setEmailState] = useState("");
  const edited = useRef({ name: false, email: false });

  useEffect(() => {
    if (!loaded) return;
    if (!edited.current.name) {
      setNameState(profile.name.length <= maxNameLength ? profile.name : "");
    }
    if (!edited.current.email) setEmailState(profile.email);
  }, [loaded, maxNameLength, profile]);

  const setName = useCallback((value: string) => {
    edited.current.name = true;
    setNameState(value);
  }, []);
  const setEmail = useCallback((value: string) => {
    edited.current.email = true;
    setEmailState(value);
  }, []);

  return { loaded, name, email, setName, setEmail, remember };
}
