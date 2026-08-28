import { IANA_TOP_LEVEL_DOMAINS } from "./iana-tlds";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const COMMON_EMAIL_DOMAIN_CORRECTIONS: Readonly<Record<string, string>> = {
  "gamil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.om": "gmail.com",
  "gmali.com": "gmail.com",
  "gmial.com": "gmail.com",
  "hotmai.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "iclod.com": "icloud.com",
  "icloud.co": "icloud.com",
  "icloud.con": "icloud.com",
  "iclud.com": "icloud.com",
  "outloo.com": "outlook.com",
  "outlok.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "protonmai.com": "protonmail.com",
  "protonmail.co": "protonmail.com",
  "protonmail.con": "protonmail.com",
  "protnmail.com": "protonmail.com",
  "yaoo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "yahooo.com": "yahoo.com",
};

export type EmailAddressAssessment = {
  valid: boolean;
  normalized: string;
  suggestion?: string;
  message?: string;
};

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Validate syntax and the public DNS suffix, then offer only high-confidence typo corrections. */
export function assessEmailAddress(value: unknown): EmailAddressAssessment {
  const normalized = typeof value === "string" ? normaliseEmail(value) : "";
  if (!normalized || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    return {
      valid: false,
      normalized,
      message: "Enter a complete email address, including the part after the dot.",
    };
  }

  const at = normalized.lastIndexOf("@");
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const validLocal =
    local.length <= 64 &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local);
  const knownDomain = COMMON_EMAIL_DOMAIN_CORRECTIONS[domain];
  let asciiDomain = "";
  try {
    asciiDomain = new URL("http://" + domain).hostname.toLowerCase();
  } catch {
    // The syntax result below remains invalid.
  }
  const validDomain =
    asciiDomain.length <= 253 &&
    asciiDomain
      .split(".")
      .every(
        (label) =>
          label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      );
  const tld = asciiDomain.split(".").at(-1) ?? "";
  const suggestion = knownDomain ? local + "@" + knownDomain : undefined;

  if (!validLocal || !validDomain || !IANA_TOP_LEVEL_DOMAINS.has(tld)) {
    return {
      valid: false,
      normalized,
      suggestion,
      message: !validLocal
        ? "The part before @ contains an email formatting mistake."
        : tld
          ? "“." + tld + "” is not a recognised public email ending."
          : "Enter a complete email address, including the part after the dot.",
    };
  }

  return {
    valid: true,
    normalized,
    suggestion,
    ...(suggestion ? { message: "That email domain looks like a common typing mistake." } : {}),
  };
}

export function isValidEmail(value: unknown): value is string {
  return assessEmailAddress(value).valid;
}
