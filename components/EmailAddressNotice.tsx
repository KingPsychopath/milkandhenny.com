import { assessEmailAddress } from "@/features/tickets/types";

export function EmailAddressNotice({
  email,
  onAcceptSuggestion,
  className = "",
}: {
  email: string;
  onAcceptSuggestion: (email: string) => void;
  className?: string;
}) {
  const assessment = assessEmailAddress(email);
  const suggestion = assessment.suggestion;
  const domain = email.trim().split("@")[1] ?? "";
  if (!domain.includes(".") || (!suggestion && assessment.valid)) return null;

  return (
    <p
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
          className="font-bold underline underline-offset-2"
        >
          use {suggestion}
        </button>
      ) : null}
    </p>
  );
}
