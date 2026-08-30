/**
 * Declares who owns the submitted text after asynchronous validation.
 * Accepted and discarded submissions stay cleared; retryable submissions may be
 * restored when the player has not already typed or queued another guess.
 */
export type GuessSubmissionResult = "accepted" | "discarded" | "retryable";
