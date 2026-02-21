import "server-only";

const NOTES_ENABLED = process.env.NOTES_ENABLED !== "false";
const NOTE_META_PREFIX = "notes:meta:";
const NOTE_INDEX_KEY = "notes:index";
const WORD_CONTENT_PREFIX = "words/";
const NOTE_CONTENT_SUFFIX = "/content.md";
const LEGACY_NOTE_CONTENT_PREFIX = "notes/";
const NOTE_SHARE_PREFIX = "notes:share:";
const NOTE_SHARE_INDEX_PREFIX = "notes:share-index:";

const SHARE_DEFAULT_EXPIRY_DAYS = 7;
const SHARE_MAX_EXPIRY_DAYS = 30;
const SHARE_PIN_MAX_ATTEMPTS = 5;
const SHARE_PIN_LOCKOUT_SECONDS = 15 * 60;

function noteMetaKey(slug: string): string {
  return `${NOTE_META_PREFIX}${slug}`;
}

function noteContentKey(type: string, slug: string): string {
  return `${WORD_CONTENT_PREFIX}${type}/${slug}${NOTE_CONTENT_SUFFIX}`;
}

function legacyNoteContentKey(slug: string): string {
  return `${LEGACY_NOTE_CONTENT_PREFIX}${slug}${NOTE_CONTENT_SUFFIX}`;
}

function noteShareKey(id: string): string {
  return `${NOTE_SHARE_PREFIX}${id}`;
}

function noteShareIndexKey(slug: string): string {
  return `${NOTE_SHARE_INDEX_PREFIX}${slug}`;
}

export {
  NOTES_ENABLED,
  NOTE_INDEX_KEY,
  SHARE_DEFAULT_EXPIRY_DAYS,
  SHARE_MAX_EXPIRY_DAYS,
  SHARE_PIN_MAX_ATTEMPTS,
  SHARE_PIN_LOCKOUT_SECONDS,
  noteMetaKey,
  noteContentKey,
  legacyNoteContentKey,
  noteShareKey,
  noteShareIndexKey,
};
