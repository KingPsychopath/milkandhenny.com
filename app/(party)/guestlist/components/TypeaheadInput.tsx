'use client';

import { useState, useRef, useMemo, useId, useEffect } from 'react';

type TypeaheadInputProps = {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder: string;
  label: string;
};

/** Searchable dropdown input with keyboard navigation. */
export function TypeaheadInput({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
}: TypeaheadInputProps) {
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const filteredSuggestions = useMemo(() => {
    if (!value.trim()) return suggestions.slice(0, 10);
    const query = value.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(query)).slice(0, 10);
  }, [value, suggestions]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filteredSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      onChange(filteredSuggestions[highlightedIndex]);
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-stone-700 mb-1.5">{label}</label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => setIsOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
        aria-autocomplete="list"
      />
      {isOpen && filteredSuggestions.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute z-20 w-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
          role="listbox"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <li
              id={`${listboxId}-option-${index}`}
              key={`${suggestion}-${index}`}
              className={`px-4 py-2.5 cursor-pointer transition-colors ${
                index === highlightedIndex ? 'bg-amber-50 text-amber-900' : 'hover:bg-stone-50'
              }`}
              onClick={() => {
                onChange(suggestion);
                setIsOpen(false);
              }}
              role="option"
              aria-selected={index === highlightedIndex}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

