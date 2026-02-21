"use client";

import { useState } from "react";
import type { NoteVisibility, ShareStateFilter, WordType } from "../types";

export function useEditorFilters() {
  const [showPreview, setShowPreview] = useState(false);
  const [newShareExpiryDays, setNewShareExpiryDays] = useState<number>(7);
  const [shareStateFilter, setShareStateFilter] = useState<ShareStateFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<WordType | "all">("all");
  const [filterVisibility, setFilterVisibility] = useState<NoteVisibility | "all">("all");
  const [filterTag, setFilterTag] = useState("");
  const [mediaSearchQuery, setMediaSearchQuery] = useState("");

  function clearFilters() {
    setSearchQuery("");
    setFilterType("all");
    setFilterVisibility("all");
    setFilterTag("");
  }

  return {
    showPreview,
    setShowPreview,
    newShareExpiryDays,
    setNewShareExpiryDays,
    shareStateFilter,
    setShareStateFilter,
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filterVisibility,
    setFilterVisibility,
    filterTag,
    setFilterTag,
    mediaSearchQuery,
    setMediaSearchQuery,
    clearFilters,
  };
}

