function configured(name: string) {
  return process.env[name]?.trim() || null;
}

export function getRuntimeCommitSha() {
  return configured("APP_COMMIT_SHA") ?? configured("RAILWAY_GIT_COMMIT_SHA");
}

export function getRuntimeInstanceId() {
  return (
    configured("APP_INSTANCE_ID") ??
    configured("RAILWAY_REPLICA_ID") ??
    configured("HOSTNAME") ??
    `local-${process.pid}`
  );
}

export function getRuntimeMetadata() {
  return {
    environment: configured("APP_ENV") ?? process.env.NODE_ENV ?? "unknown",
    version: configured("APP_VERSION") ?? "0.1.0",
    commit: getRuntimeCommitSha(),
  };
}
