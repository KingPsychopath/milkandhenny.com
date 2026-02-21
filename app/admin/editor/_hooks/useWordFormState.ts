"use client";

import { useCallback, useState } from "react";
import type { NoteRecord, NoteVisibility, WordType } from "../types";

export function useWordFormState() {
  const [createSlug, setCreateSlug] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createSubtitle, setCreateSubtitle] = useState("");
  const [createImage, setCreateImage] = useState("");
  const [createType, setCreateType] = useState<WordType>("note");
  const [createVisibility, setCreateVisibility] = useState<NoteVisibility>("private");
  const [createTags, setCreateTags] = useState("");
  const [createFeatured, setCreateFeatured] = useState(false);
  const [createMarkdown, setCreateMarkdown] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editType, setEditType] = useState<WordType>("note");
  const [editVisibility, setEditVisibility] = useState<NoteVisibility>("private");
  const [editTags, setEditTags] = useState("");
  const [editFeatured, setEditFeatured] = useState(false);
  const [editMarkdown, setEditMarkdown] = useState("");

  const parseTags = useCallback((raw: string): string[] => {
    return [...new Set(raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  }, []);

  const resetCreateForm = useCallback(() => {
    setCreateSlug("");
    setCreateTitle("");
    setCreateSubtitle("");
    setCreateImage("");
    setCreateType("note");
    setCreateVisibility("private");
    setCreateTags("");
    setCreateFeatured(false);
    setCreateMarkdown("");
  }, []);

  const setEditFromRecord = useCallback((record: NoteRecord) => {
    setEditTitle(record.meta.title);
    setEditSubtitle(record.meta.subtitle ?? "");
    setEditImage(record.meta.image ?? "");
    setEditType(record.meta.type);
    setEditVisibility(record.meta.visibility);
    setEditTags(record.meta.tags.join(", "));
    setEditFeatured(!!record.meta.featured);
    setEditMarkdown(record.markdown);
  }, []);

  const appendSnippet = useCallback((snippet: string) => {
    setEditMarkdown((prev) => {
      const base = prev.trimEnd();
      return base ? `${base}\n\n${snippet}` : snippet;
    });
  }, []);

  return {
    createSlug,
    setCreateSlug,
    createTitle,
    setCreateTitle,
    createSubtitle,
    setCreateSubtitle,
    createImage,
    setCreateImage,
    createType,
    setCreateType,
    createVisibility,
    setCreateVisibility,
    createTags,
    setCreateTags,
    createFeatured,
    setCreateFeatured,
    createMarkdown,
    setCreateMarkdown,
    editTitle,
    setEditTitle,
    editSubtitle,
    setEditSubtitle,
    editImage,
    setEditImage,
    editType,
    setEditType,
    editVisibility,
    setEditVisibility,
    editTags,
    setEditTags,
    editFeatured,
    setEditFeatured,
    editMarkdown,
    setEditMarkdown,
    parseTags,
    resetCreateForm,
    setEditFromRecord,
    appendSnippet,
  };
}

