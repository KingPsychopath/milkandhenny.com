/**
 * Structured server-side logger.
 *
 * Outputs JSON lines in production (easy to filter in Vercel / any log drain)
 * and human-readable lines in development.
 *
 * Usage:
 *   import { log } from '@/lib/platform/logger';
 *   log.error('upload.transfer', 'Processing failed', { transferId, filename }, error);
 *   log.warn('cron.cleanup', 'R2 not configured — skipping file deletion');
 *   log.info('auth', 'Staff PIN verified', { ip });
 */

import "server-only";

type LogLevel = 'info' | 'warn' | 'error';

const IS_DEV = process.env.NODE_ENV === 'development';

function formatError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  }
  return { message: String(err) };
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>,
  err?: unknown
) {
  const entry: Record<string, unknown> = {
    level,
    scope,
    message,
    ...(context ? { context } : {}),
    ...(err ? { error: formatError(err) } : {}),
    ts: new Date().toISOString(),
  };

  if (IS_DEV) {
    const prefix = level === 'error' ? '✗' : level === 'warn' ? '⚠' : '·';
    const tag = `[${scope}]`;
    const extra = context ? ` ${JSON.stringify(context)}` : '';
    const errLine = err ? `\n  → ${formatError(err).message}` : '';

    // Use appropriate console method so dev tools colour the output
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`${prefix} ${tag} ${message}${extra}${errLine}`);
  } else {
    // Structured JSON — one line per entry, easy to parse in Vercel / Datadog / etc.
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(JSON.stringify(entry));
  }
}

export const log = {
  info: (scope: string, message: string, context?: Record<string, unknown>) =>
    emit('info', scope, message, context),

  warn: (scope: string, message: string, context?: Record<string, unknown>) =>
    emit('warn', scope, message, context),

  error: (scope: string, message: string, context?: Record<string, unknown>, err?: unknown) =>
    emit('error', scope, message, context, err),
};
