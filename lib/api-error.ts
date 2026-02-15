/**
 * Safe API error response builder.
 *
 * Logs the real error server-side with structured context,
 * returns a generic user-safe message to the client.
 * Never leaks stack traces, internal library errors, or env details.
 *
 * Usage:
 *   return apiError('upload.transfer', 'Upload failed', e, { transferId });
 *   return apiError('guests.add', 'Failed to add guest', error);
 */

import { NextResponse } from 'next/server';
import { log } from './logger';

/**
 * Build a safe 500 JSON response. Logs the real error, returns a clean message.
 *
 * @param scope   - Logger scope (e.g. 'upload.transfer', 'guests.bootstrap')
 * @param message - User-safe error message (returned to client)
 * @param err     - The caught error (logged server-side, never exposed)
 * @param context - Optional structured context for the log entry
 * @param status  - HTTP status code (default 500)
 */
export function apiError(
  scope: string,
  message: string,
  err?: unknown,
  context?: Record<string, unknown>,
  status = 500
): NextResponse {
  log.error(scope, message, context, err);
  return NextResponse.json({ error: message }, { status });
}
