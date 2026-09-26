import { queryOptions } from "@tanstack/react-query";
import { listPublishedPitchesFn, readPublishedPitchFn } from "./pitches.functions";

// The wall response includes account pitches and creator identity. Identity transitions clear it.
export const pitchWallQueryRoot = ["pitches", "wall", "viewer"] as const;

export const pitchWallQuery = (search = "") =>
  queryOptions({
    queryKey: [...pitchWallQueryRoot, search] as const,
    queryFn: () => listPublishedPitchesFn({ data: { search } }),
    staleTime: 10_000,
  });

export const publishedPitchQueryRoot = ["pitches", "published"] as const;

export const publishedPitchQuery = (deckId: string, editionNumber?: number) =>
  queryOptions({
    queryKey: [...publishedPitchQueryRoot, deckId, editionNumber ?? "latest"] as const,
    queryFn: () => readPublishedPitchFn({ data: { deckId, editionNumber } }),
    staleTime: 10_000,
  });
