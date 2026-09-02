export const TEAM_COLOUR_KEYS = ["amber", "sage", "plum", "sky"] as const;
export type TeamColourKey = (typeof TEAM_COLOUR_KEYS)[number];

export type TeamPaletteEntry = {
  colourKey: TeamColourKey;
  defaultName: string;
};

/** Email clients cannot read the site's CSS variables, so keep their accessible ink here. */
export const TEAM_EMAIL_COLOURS: Record<
  TeamColourKey,
  { border: string; wash: string; ink: string }
> = {
  amber: { border: "#b45309", wash: "#fffbeb", ink: "#78350f" },
  sage: { border: "#3f7d58", wash: "#f0fdf4", ink: "#14532d" },
  plum: { border: "#8b5a83", wash: "#fdf4ff", ink: "#581c87" },
  sky: { border: "#39779b", wash: "#f0f9ff", ink: "#0c4a6e" },
};

const TEAM_PALETTES: Record<2 | 3 | 4, readonly TeamPaletteEntry[]> = {
  2: [
    { colourKey: "amber", defaultName: "Amber" },
    { colourKey: "sage", defaultName: "Sage" },
  ],
  3: [
    { colourKey: "amber", defaultName: "Amber" },
    { colourKey: "sage", defaultName: "Sage" },
    { colourKey: "plum", defaultName: "Plum" },
  ],
  4: [
    { colourKey: "amber", defaultName: "Amber" },
    { colourKey: "sage", defaultName: "Sage" },
    { colourKey: "plum", defaultName: "Plum" },
    { colourKey: "sky", defaultName: "Sky" },
  ],
};

export function isTeamCount(value: unknown): value is 2 | 3 | 4 {
  return value === 2 || value === 3 || value === 4;
}

export function isTeamColourKey(value: unknown): value is TeamColourKey {
  return typeof value === "string" && TEAM_COLOUR_KEYS.includes(value as TeamColourKey);
}

export function teamPaletteForCount(count: 2 | 3 | 4): readonly TeamPaletteEntry[] {
  return TEAM_PALETTES[count];
}

export function fallbackTeamColour(index: number): TeamColourKey {
  return TEAM_COLOUR_KEYS[
    ((index % TEAM_COLOUR_KEYS.length) + TEAM_COLOUR_KEYS.length) % TEAM_COLOUR_KEYS.length
  ]!;
}
