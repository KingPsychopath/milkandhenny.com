export interface HotAndColdRankedWordReview {
  frequency: number;
  rank: number;
  reasons: string[];
  word: string;
}

export interface HotAndColdRankChangeReview {
  change: number;
  previousRank: number;
  rank: number;
  word: string;
}

export interface HotAndColdTargetReview {
  approvalHash: string;
  changes: HotAndColdRankChangeReview[];
  comparisons: Array<{
    closer: string;
    closerRank: number;
    farther: string;
    fartherRank: number;
    passes: boolean;
  }>;
  expectedClose: Array<{ rank: number; word: string }>;
  suspicious: HotAndColdRankedWordReview[];
  top: HotAndColdRankedWordReview[];
}

export interface HotAndColdUpcomingReview extends HotAndColdTargetReview {
  approved: boolean;
  date: string;
  hints: string[];
  puzzle: number;
  target: string;
}

export interface HotAndColdQualityReport {
  currentPuzzle: number;
  judgingVersion: string;
  releaseReady: boolean;
  upcoming: HotAndColdUpcomingReview[];
  windowSize: number;
}
