"use client";

import { useEffect, useId, useRef } from "react";

import { assessEmailAddress } from "@/lib/shared/email-address";

function emailAddressFeedback(email: string) {
  const assessment = assessEmailAddress(email);
  const domain = email.trim().split("@")[1] ?? "";
  const visible = domain.includes(".") && Boolean(assessment.suggestion || !assessment.valid);
  return { assessment, visible };
}

export function EmailAddressNotice({
  email,
  onAcceptSuggestion,
  id,
  inputId,
  className = "",
}: {
  email: string;
  onAcceptSuggestion: (email: string) => void;
  id?: string;
  inputId?: string;
  className?: string;
}) {
  const generatedId = useId();
  const noticeId = id ?? generatedId;
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const { assessment, visible } = emailAddressFeedback(email);
  const suggestion = assessment.suggestion;

  useEffect(() => {
    const input = inputId
      ? document.getElementById(inputId)
      : noticeRef.current?.parentElement?.querySelector('input[type="email"]');
    if (!(input instanceof HTMLInputElement)) return;
    const priorDescribedBy = input.getAttribute("aria-describedby");
    const priorInvalid = input.getAttribute("aria-invalid");
    const descriptionIds = new Set((priorDescribedBy ?? "").split(/\s+/).filter(Boolean));
    descriptionIds.add(noticeId);
    input.setAttribute("aria-describedby", [...descriptionIds].join(" "));
    if (!assessment.valid) input.setAttribute("aria-invalid", "true");
    input.setCustomValidity(assessment.valid ? "" : (assessment.message ?? "Enter a valid email"));
    return () => {
      input.setCustomValidity("");
      if (priorDescribedBy === null) input.removeAttribute("aria-describedby");
      else input.setAttribute("aria-describedby", priorDescribedBy);
      if (priorInvalid === null) input.removeAttribute("aria-invalid");
      else input.setAttribute("aria-invalid", priorInvalid);
    };
  }, [assessment.message, assessment.valid, inputId, noticeId, visible]);

  if (!visible) return null;

  return (
    <p
      ref={noticeRef}
      id={noticeId}
      role={assessment.valid ? "status" : "alert"}
      className={[
        "mt-2 font-mono text-micro leading-relaxed text-[var(--prose-hashtag)]",
        className,
      ].join(" ")}
    >
      {assessment.message}{" "}
      {suggestion ? (
        <button
          type="button"
          onClick={() => onAcceptSuggestion(suggestion)}
          className="inline-flex min-h-11 items-center font-bold underline underline-offset-2"
        >
          use {suggestion}
        </button>
      ) : null}
    </p>
  );
}
