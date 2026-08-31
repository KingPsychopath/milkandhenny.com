"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getStorageKey } from "@/lib/shared/storage-keys";
import { isValidEmail, normaliseEmail as normaliseSharedEmail } from "@/lib/shared/email-address";
import { getStored, removeStored, setStored } from "./storage";

/**
 * Shared, editable defaults for fields about the person using this browser.
 * Add future fields here with an explicit normaliser and an empty default; do not turn the profile
 * into an untyped store for feature state or credentials.
 */
export interface BrowserProfile {
  name: string;
  gameName: string;
  email: string;
}

const EMPTY_PROFILE: BrowserProfile = { name: "", gameName: "", email: "" };
const PROFILE_CHANGE_EVENT = "mah:browser-profile-change";
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;

function normaliseName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : "";
}

export function gameNameDefault(value: string, maxLength: number): string {
  const name = normaliseName(value);
  if (!name || maxLength < 2) return "";
  const characters = [...name];
  if (characters.length <= maxLength) return name;
  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}

function normaliseEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const email = normaliseSharedEmail(value);
  return email.length <= MAX_EMAIL_LENGTH && isValidEmail(email) ? email : "";
}

export function emailFormDefault(initialEmail: unknown, rememberedEmail: unknown): string {
  return normaliseEmail(initialEmail) || normaliseEmail(rememberedEmail);
}

export function readBrowserProfile(): BrowserProfile {
  try {
    const value: unknown = JSON.parse(getStored("browserProfile") ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_PROFILE;
    return {
      name: normaliseName("name" in value ? value.name : undefined),
      gameName: normaliseName("gameName" in value ? value.gameName : undefined),
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
  const gameName =
    fields.gameName === undefined ? current.gameName : normaliseName(fields.gameName);
  const email = fields.email === undefined ? current.email : normaliseEmail(fields.email);
  const next = {
    name: name || current.name,
    gameName: gameName || current.gameName,
    email: email || current.email,
  };

  if (setStored("browserProfile", JSON.stringify(next))) {
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT));
  }
  return next;
}

/** Removes only the shared profile. Feature preferences, saved work, and sessions stay intact. */
export function forgetBrowserProfile(): boolean {
  const removed = removeStored("browserProfile");
  if (removed) window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT));
  return removed;
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

  const forget = useCallback(() => {
    const removed = forgetBrowserProfile();
    if (removed) setProfile(EMPTY_PROFILE);
    return removed;
  }, []);

  return { loaded, profile, remember, forget };
}

/** Editable form defaults which do not overwrite a field after the person starts typing. */
export function useBrowserProfileForm({
  maxNameLength = MAX_NAME_LENGTH,
  initialEmail,
}: { maxNameLength?: number; initialEmail?: string } = {}) {
  const { loaded, profile, remember } = useBrowserProfile();
  const [name, setNameState] = useState("");
  const [email, setEmailState] = useState(() => emailFormDefault(initialEmail, ""));
  const edited = useRef({ name: false, email: false });

  useEffect(() => {
    if (!loaded) return;
    if (!edited.current.name) {
      setNameState(profile.name.length <= maxNameLength ? profile.name : "");
    }
    if (!edited.current.email) setEmailState(emailFormDefault(initialEmail, profile.email));
  }, [initialEmail, loaded, maxNameLength, profile]);

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

/** A game nickname is a separate editable convenience from the person's preferred full name. */
export function useBrowserGameNameForm({ maxNameLength = 32 } = {}) {
  const { loaded, profile, remember: rememberProfile } = useBrowserProfile();
  const [name, setNameState] = useState("");
  const edited = useRef(false);

  useEffect(() => {
    if (!loaded || edited.current) return;
    const preferred = profile.gameName || profile.name;
    setNameState(gameNameDefault(preferred, maxNameLength));
  }, [loaded, maxNameLength, profile]);

  const setName = useCallback((value: string) => {
    edited.current = true;
    setNameState(value);
  }, []);
  const remember = useCallback(
    (value: string) => rememberProfile({ gameName: value }),
    [rememberProfile],
  );

  return { loaded, name, setName, remember };
}
