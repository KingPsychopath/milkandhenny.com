"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { ActionDialog } from "@/components/ActionDialog";

export interface ConfirmDialogOptions {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: "default" | "danger";
}

export interface PromptDialogOptions extends ConfirmDialogOptions {
  label: string;
  inputType?: "text" | "password" | "number";
  autoComplete?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  validate?: (value: string) => string | null;
}

type DialogRequest =
  | ({ kind: "confirm" } & ConfirmDialogOptions)
  | ({ kind: "prompt" } & PromptDialogOptions);

type PendingResolution =
  | { kind: "confirm"; resolve: (value: boolean) => void }
  | { kind: "prompt"; resolve: (value: string | null) => void };

export function useActionDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const pendingResolution = useRef<PendingResolution | null>(null);
  const inputId = useId();
  const errorId = useId();

  const cancelPending = useCallback(() => {
    const pending = pendingResolution.current;
    pendingResolution.current = null;
    setRequest(null);
    setValue("");
    setValidationError(null);
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(false);
    else pending.resolve(null);
  }, []);

  useEffect(
    () => () => {
      const pending = pendingResolution.current;
      pendingResolution.current = null;
      if (!pending) return;
      if (pending.kind === "confirm") pending.resolve(false);
      else pending.resolve(null);
    },
    [],
  );

  const confirm = useCallback(
    (options: ConfirmDialogOptions) => {
      cancelPending();
      return new Promise<boolean>((resolve) => {
        pendingResolution.current = { kind: "confirm", resolve };
        setRequest({ kind: "confirm", ...options });
      });
    },
    [cancelPending],
  );

  const prompt = useCallback(
    (options: PromptDialogOptions) => {
      cancelPending();
      setValue(options.defaultValue ?? "");
      return new Promise<string | null>((resolve) => {
        pendingResolution.current = { kind: "prompt", resolve };
        setRequest({ kind: "prompt", ...options });
      });
    },
    [cancelPending],
  );

  const handleConfirm = useCallback(() => {
    const pending = pendingResolution.current;
    if (!request || !pending) return;
    if (request.kind === "confirm" && pending.kind === "confirm") {
      pendingResolution.current = null;
      setRequest(null);
      pending.resolve(true);
      return;
    }
    if (request.kind !== "prompt" || pending.kind !== "prompt") return;

    const normalized = value.trim();
    const error =
      request.required && !normalized
        ? `${request.label} is required.`
        : request.validate?.(value) ?? null;
    if (error) {
      setValidationError(error);
      return;
    }
    pendingResolution.current = null;
    setRequest(null);
    const submittedValue = value;
    setValue("");
    setValidationError(null);
    pending.resolve(submittedValue);
  }, [request, value]);

  const dialog = request ? (
    <ActionDialog
      title={request.title}
      description={request.description}
      eyebrow={request.eyebrow}
      confirmLabel={request.confirmLabel ?? "continue"}
      cancelLabel={request.cancelLabel}
      intent={request.intent}
      onCancel={cancelPending}
      onConfirm={handleConfirm}
    >
      {request.kind === "prompt" ? (
        <div>
          <label htmlFor={inputId} className="block font-mono text-xs theme-muted">
            {request.label}
          </label>
          <input
            id={inputId}
            type={request.inputType ?? "text"}
            value={value}
            min={request.min}
            max={request.max}
            required={request.required}
            autoComplete={request.autoComplete}
            placeholder={request.placeholder}
            aria-invalid={validationError ? true : undefined}
            aria-describedby={validationError ? errorId : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setValidationError(null);
            }}
            className="mt-2 min-h-12 w-full rounded-md border theme-border bg-transparent px-4 font-mono text-sm outline-none focus:border-[var(--foreground)]"
          />
          {validationError ? (
            <p id={errorId} className="mt-2 font-mono text-xs text-red-700" role="alert">
              {validationError}
            </p>
          ) : null}
        </div>
      ) : null}
    </ActionDialog>
  ) : null;

  return { confirm, prompt, dialog, isOpen: request !== null };
}
