export const POLL_STATUSES = ["draft", "open", "closed", "archived"] as const;
export const POLL_SELECTION_MODES = ["single", "multiple"] as const;
export const POLL_RESULT_VISIBILITIES = ["always", "after_vote", "hidden"] as const;

export type PollStatus = (typeof POLL_STATUSES)[number];
export type PollSelectionMode = (typeof POLL_SELECTION_MODES)[number];
export type PollResultVisibility = (typeof POLL_RESULT_VISIBILITIES)[number];

export type PollOption = { id: string; label: string };

export type PollResult = PollOption & { votes: number; weight: number; percentage: number };

export type PollRecord = {
  id: string;
  slug: string;
  eventSlug: string | null;
  title: string;
  intro: string;
  question: string;
  options: PollOption[];
  selectionMode: PollSelectionMode;
  resultVisibility: PollResultVisibility;
  showPercentages: boolean;
  status: PollStatus;
  responseCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicPoll = PollRecord & { results: PollResult[] | null };

export type AdminPoll = PollRecord & { results: PollResult[] };

export type PollVoteResult = {
  poll: PollRecord;
  selections: string[];
  results: PollResult[] | null;
};
