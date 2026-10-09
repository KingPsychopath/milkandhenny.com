/** Local mode deliberately excludes inherited provider credentials and dotenv files. */
export function localDevEnvironment(inherited, secret, port = 3000) {
  const env = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (
      /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|TERM|COLORTERM|NO_COLOR|FORCE_COLOR|PNPM_HOME|SYSTEMROOT|COMSPEC|APPDATA|LOCALAPPDATA)$/.test(
        key,
      ) ||
      /^(LC_|XDG_)/.test(key)
    )
      env[key] = value;
  }
  Object.assign(env, {
    NODE_ENV: "development",
    APP_ENV: "development",
    MAH_LOCAL_DEV: "1",
    VITE_BASE_URL: `http://127.0.0.1:${port}`,
    VITE_MEDIA_PUBLIC_URL: "http://127.0.0.1:8333/local-public",
    DATABASE_URL: "postgres://postgres:local-development@127.0.0.1:55433/milkandhenny",
    DATABASE_SCHEMA_MODE: "migrate",
    S3_ENDPOINT: "http://127.0.0.1:8333",
    AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
    R2_ACCOUNT_ID: "local",
    R2_PUBLIC_BUCKET: "local-public",
    R2_PRIVATE_BUCKET: "local-private",
    R2_PUBLIC_ACCESS_KEY: "local-development",
    R2_PRIVATE_ACCESS_KEY: "local-development",
    R2_PUBLIC_SECRET_KEY: "local-development-secret",
    R2_PRIVATE_SECRET_KEY: "local-development-secret",
    AUTH_SECRET: secret,
    ADMIN_PASSWORD: "local-admin-password",
    UPLOAD_PIN: "local-upload-pin",
    EMAIL_TRANSPORT: "mailpit",
    EMAIL_MAILPIT_URL: "http://127.0.0.1:18025",
    MEDIA_PROCESSOR_MODE: "local",
  });
  for (const key of [
    "AUTH_TOKEN_STORE",
    "AUTH_CLI_STORE",
    "ATTENDEE_SESSION_STORE",
    "PASSKEY_CEREMONY_STORE",
    "UPLOAD_ACCESS_STORE",
    "RATE_LIMIT_STORE",
    "REPORT_STORE",
    "BEST_DRESSED_STORE",
    "ALBUM_STORE",
    "ALBUM_OBJECT_DELETION_RUNNER",
    "WORD_STORE",
    "WORD_SHARE_STORE",
    "TRANSFER_CATALOGUE_STORE",
    "TRANSFER_MEDIA_JOB_STORE",
    "TRANSFER_MEDIA_EVENT_BACKPLANE",
    "TRANSFER_OBJECT_DELETION_RUNNER",
    "MEDIA_WORKER_STATUS_STORE",
    "MULTIPLAYER_REALTIME_BACKPLANE",
    "OFFICIAL_GAME_RESULT_OUTBOX_STORE",
    "HOT_AND_COLD_ROOM_STORE",
    "SPELLING_PARTY_ROOM_STORE",
    "CENTRE_ROOM_STORE",
    "TWIN_ROOM_STORE",
    "SAME_BRAIN_ROOM_STORE",
    "LIARS_ROOM_STORE",
    "PAIRED_GAME_ROOM_STORE",
    "DRAW_COUNTRY_ROOM_STORE",
    "FAMILY_FEUD_ROOM_STORE",
    "GAME_POOL_CREDENTIAL_STORE",
    "PITCH_PRESENTATION_STORE",
  ])
    env[key] = "postgres";
  return env;
}
