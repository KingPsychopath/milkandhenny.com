"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

export interface AppSelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface AppSelectProps {
  value: string | number;
  options: readonly AppSelectOption[];
  onValueChange: (value: string) => void;
  id?: string;
  name?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  onBlur?: () => void;
  tone?: "theme" | "cream" | "night";
  className?: string;
}

const toneClasses = {
  theme: {
    trigger: "border theme-border bg-[var(--background)] text-[var(--foreground)]",
    menu: "border theme-border bg-[var(--background)] text-[var(--foreground)]",
    active: "bg-[var(--stone-100)]",
    muted: "theme-muted",
  },
  cream: {
    trigger: "border-black/15 bg-white/45 text-black",
    menu: "border-black/15 bg-[var(--things-cream)] text-black",
    active: "bg-black/[0.07]",
    muted: "text-black/45",
  },
  night: {
    trigger: "border-white/15 bg-[var(--things-night)] text-white",
    menu: "border-white/15 bg-[var(--things-night)] text-white",
    active: "bg-white/10",
    muted: "text-white/45",
  },
} as const;

function nextEnabledIndex(options: readonly AppSelectOption[], from: number, direction: 1 | -1) {
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (from + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return from;
}

export function AppSelect({
  value,
  options,
  onValueChange,
  id,
  name,
  ariaLabel,
  title,
  disabled = false,
  onBlur,
  tone = "theme",
  className = "",
}: AppSelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `app-select-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => String(option.value) === String(value)),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const styles = toneClasses[tone];
  const selected = options[selectedIndex];

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const listbox = listboxRef.current;
    if (!trigger || !listbox) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 8;
    const maxHeight = Math.min(320, window.innerHeight - gutter * 2);
    const measuredHeight = Math.min(listbox.scrollHeight, maxHeight);
    const roomBelow = window.innerHeight - rect.bottom - gutter;
    const opensAbove = roomBelow < measuredHeight && rect.top > roomBelow;
    const top = opensAbove
      ? Math.max(gutter, rect.top - measuredHeight - gutter)
      : Math.min(window.innerHeight - measuredHeight - gutter, rect.bottom + gutter);
    const width = Math.max(rect.width, Math.min(240, window.innerWidth - gutter * 2));
    const left = Math.min(Math.max(gutter, rect.left), window.innerWidth - width - gutter);
    setMenuStyle({ top, left, width, maxHeight, visibility: "visible" });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    positionMenu();
    listboxRef.current?.focus({ preventScroll: true });
  }, [open, positionMenu, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => positionMenu();
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listboxRef.current?.contains(target)) {
        setOpen(false);
        onBlur?.();
      }
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", closeFromOutside);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", closeFromOutside);
    };
  }, [onBlur, open, positionMenu]);

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const choose = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onValueChange(String(option.value));
      close();
      onBlur?.();
    },
    [close, onBlur, onValueChange, options],
  );

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        nextEnabledIndex(options, current, event.key === "ArrowDown" ? 1 : -1),
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const start = event.key === "Home" ? -1 : 0;
      setActiveIndex(nextEnabledIndex(options, start, event.key === "Home" ? 1 : -1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      onBlur?.();
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      typeaheadRef.current += event.key.toLocaleLowerCase();
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
      typeaheadTimerRef.current = setTimeout(() => {
        typeaheadRef.current = "";
      }, 500);
      const match = options.findIndex(
        (option) =>
          !option.disabled && option.label.toLocaleLowerCase().startsWith(typeaheadRef.current),
      );
      if (match >= 0) setActiveIndex(match);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex min-h-11 items-center justify-between gap-3 rounded-full px-4 font-mono text-xs shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${styles.trigger} ${className}`}
      >
        <span className="truncate">{selected?.label ?? String(value)}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="m3.5 6 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {name ? <input type="hidden" name={name} value={String(value)} /> : null}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-labelledby={ariaLabel ? undefined : triggerId}
              aria-activedescendant={`${listboxId}-option-${activeIndex}`}
              onKeyDown={handleListboxKeyDown}
              style={menuStyle}
              className={`fixed z-[100] overflow-y-auto rounded-[1.35rem] border p-1.5 font-mono text-xs shadow-xl outline-none ${styles.menu}`}
            >
              {options.map((option, index) => {
                const isSelected = String(option.value) === String(value);
                const isActive = index === activeIndex;
                return (
                  <div
                    key={String(option.value)}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onPointerMove={() => !option.disabled && setActiveIndex(index)}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      choose(index);
                    }}
                    className={`flex min-h-11 cursor-default items-center gap-3 rounded-[1rem] px-3 outline-none ${isActive ? styles.active : ""} ${option.disabled ? `${styles.muted} opacity-50` : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-3 text-center ${isSelected ? "opacity-100" : "opacity-0"}`}
                    >
                      ✓
                    </span>
                    <span className="truncate">{option.label}</span>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
