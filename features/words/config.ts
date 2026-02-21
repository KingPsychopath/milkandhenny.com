import "server-only";

const WORD_META_PREFIX = "words:meta:";
const WORD_INDEX_KEY = "words:index";
const WORD_CONTENT_PREFIX = "words/";
const WORD_CONTENT_SUFFIX = "/content.md";
const WORD_SHARE_PREFIX = "words:share:";
const WORD_SHARE_INDEX_PREFIX = "words:share-index:";
const WORD_SHARE_SLUGS_KEY = "words:share-slugs";
const WORD_SHARE_PIN_RL_PREFIX = "words:share:pin-rl:";

const SHARE_DEFAULT_EXPIRY_DAYS = 7;
const SHARE_MAX_EXPIRY_DAYS = 30;
const SHARE_RECORD_RETENTION_DAYS = 30;
const SHARE_PIN_MAX_ATTEMPTS = 5;
const SHARE_PIN_LOCKOUT_SECONDS = 15 * 60;

function wordMetaKey(slug: string): string {
  return `${WORD_META_PREFIX}${slug}`;
}

function wordContentKey(type: string, slug: string): string {
  return `${WORD_CONTENT_PREFIX}${type}/${slug}${WORD_CONTENT_SUFFIX}`;
}

function wordShareKey(id: string): string {
  return `${WORD_SHARE_PREFIX}${id}`;
}

function wordShareIndexKey(slug: string): string {
  return `${WORD_SHARE_INDEX_PREFIX}${slug}`;
}

function wordShareSlugsKey(): string {
  return WORD_SHARE_SLUGS_KEY;
}

function wordSharePinRateLimitKey(shareId: string, ip: string): string {
  return `${WORD_SHARE_PIN_RL_PREFIX}${shareId}:${ip}`;
}

export {
  WORD_INDEX_KEY,
  SHARE_DEFAULT_EXPIRY_DAYS,
  SHARE_MAX_EXPIRY_DAYS,
  SHARE_RECORD_RETENTION_DAYS,
  SHARE_PIN_MAX_ATTEMPTS,
  SHARE_PIN_LOCKOUT_SECONDS,
  wordMetaKey,
  wordContentKey,
  wordShareKey,
  wordShareIndexKey,
  wordShareSlugsKey,
  wordSharePinRateLimitKey,
};
