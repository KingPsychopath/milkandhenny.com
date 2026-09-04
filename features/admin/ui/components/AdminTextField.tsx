import { useId, useState } from "react";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";

export function AdminTextField({
  label,
  value,
  onChange,
  type = "text",
  hint,
  className = "",
  rows,
  required = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  className?: string;
  rows?: number;
  required?: boolean;
  error?: string;
}) {
  const id = useId();
  const [validation, setValidation] = useState("");
  const problem = error || validation;
  const props = {
    id,
    value,
    required,
    "aria-invalid": problem ? (true as const) : undefined,
    "aria-describedby":
      [hint ? `${id}-hint` : "", problem ? `${id}-error` : ""].filter(Boolean).join(" ") ||
      undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValidation("");
      onChange(event.target.value);
    },
    onInvalid: (event: React.InvalidEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValidation(event.currentTarget.validationMessage),
    className:
      "mt-1 w-full min-h-11 px-3 py-2 font-mono text-sm bg-transparent border theme-border rounded text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]",
  };
  return (
    <div className={`admin-form-field block ${className}`}>
      <label htmlFor={id} className="font-mono text-micro theme-muted tracking-wide">
        {label}
        {required ? " (required)" : ""}
      </label>
      {rows ? <textarea {...props} rows={rows} /> : <input {...props} type={type} />}
      {type === "email" ? <EmailAddressNotice email={value} onAcceptSuggestion={onChange} /> : null}
      {hint ? (
        <span id={`${id}-hint`} className="mt-1 block font-mono text-micro theme-muted">
          {hint}
        </span>
      ) : null}
      {problem ? (
        <span
          id={`${id}-error`}
          role="alert"
          className="mt-1 block font-mono text-xs text-[var(--status-danger)]"
        >
          {problem}
        </span>
      ) : null}
    </div>
  );
}
