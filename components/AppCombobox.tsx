"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import type { AppSelectOption } from "./AppSelect";

interface AppComboboxProps {
  value: string;
  options: readonly AppSelectOption[];
  onValueChange: (value: string) => void;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AppCombobox({
  value,
  options,
  onValueChange,
  id,
  ariaLabel,
  placeholder,
  disabled = false,
  className = "",
}: AppComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `app-combobox-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });

  const filteredOptions = useMemo(() => {
    if (!filtering) return options;
    const query = value.trim().toLocaleLowerCase();
    if (!query) return options;
    return options.filter((option) => option.label.toLocaleLowerCase().includes(query));
  }, [filtering, options, value]);

  const positionMenu = useCallback(() => {
    const wrapper = wrapperRef.current;
    const listbox = listboxRef.current;
    if (!wrapper || !listbox) return;
    const rect = wrapper.getBoundingClientRect();
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
    if (!open || filteredOptions.length === 0) return;
    setActiveIndex((current) => Math.min(current, filteredOptions.length - 1));
    positionMenu();
  }, [filteredOptions.length, open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => positionMenu();
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !listboxRef.current?.contains(target)) {
        setOpen(false);
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
  }, [open, positionMenu]);

  const showOptions = filteredOptions.length > 0;

  const choose = (index: number) => {
    const option = filteredOptions[index];
    if (!option || option.disabled) return;
    onValueChange(String(option.value));
    setFiltering(false);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const move = (direction: 1 | -1) => {
    if (!showOptions) return;
    setActiveIndex((current) => {
      for (let offset = 1; offset <= filteredOptions.length; offset += 1) {
        const next =
          (current + direction * offset + filteredOptions.length) % filteredOptions.length;
        if (!filteredOptions[next]?.disabled) return next;
      }
      return current;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setFiltering(false);
        setActiveIndex(event.key === "ArrowDown" ? 0 : Math.max(0, options.length - 1));
        setOpen(true);
        return;
      }
      setOpen(true);
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && open && showOptions) {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <>
      <div
        ref={wrapperRef}
        className={`flex min-h-11 items-center border-b theme-border-strong transition-colors focus-within:border-[var(--foreground)] ${className}`}
      >
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          type="text"
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            setFiltering(true);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setFiltering(false);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open && showOptions}
          aria-controls={open && showOptions ? listboxId : undefined}
          aria-activedescendant={
            open && showOptions ? `${listboxId}-option-${activeIndex}` : undefined
          }
          className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm text-foreground outline-none placeholder:text-[var(--stone-400)] disabled:opacity-40"
        />
        <button
          type="button"
          disabled={disabled || options.length === 0}
          aria-label={open ? "Hide suggestions" : "Show suggestions"}
          aria-controls={open && showOptions ? listboxId : undefined}
          aria-expanded={open && showOptions}
          onClick={() => {
            setFiltering(false);
            setOpen((current) => {
              const next = !current;
              if (next) requestAnimationFrame(() => inputRef.current?.focus());
              return next;
            });
          }}
          className="inline-flex min-h-11 min-w-11 items-center justify-center theme-muted transition-opacity hover:opacity-60 disabled:opacity-30"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m3.5 6 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && showOptions && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel ? `${ariaLabel} suggestions` : "Suggestions"}
              style={menuStyle}
              className="fixed z-[100] overflow-y-auto rounded-lg border theme-border bg-[var(--background)] p-1.5 font-mono text-sm text-foreground shadow-xl"
            >
              {filteredOptions.map((option, index) => {
                const selected = String(option.value) === value;
                const active = index === activeIndex;
                return (
                  <div
                    key={String(option.value)}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={option.disabled || undefined}
                    onPointerMove={() => !option.disabled && setActiveIndex(index)}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      choose(index);
                    }}
                    className={`flex min-h-11 cursor-default items-center gap-3 rounded-md px-3 ${
                      active ? "bg-[var(--stone-100)]" : ""
                    } ${option.disabled ? "theme-muted opacity-50" : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-3 text-center ${selected ? "opacity-100" : "opacity-0"}`}
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
