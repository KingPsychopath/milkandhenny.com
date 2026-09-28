import { getMediaProcessorMode } from "@/features/media/config.server";
import { getPitchEnvironmentMode } from "@/features/things/pitches/config.server";
import type { Capability, SystemCapabilities } from "@/features/system/capabilities";
import { getMediaRole } from "@/features/system/media-role.server";
import { multiplayerTelemetrySnapshot } from "@/features/things/shared/multiplayer-runtime.server";
import type { MultiplayerTelemetrySnapshot } from "@/features/things/shared/multiplayer-telemetry";
import { getSecurityWarnings } from "@/features/auth/auth.server";
import {
  checkConnection as checkObjectStorage,
  isConfigured as isObjectStorageConfigured,
  isPrivateStorageConfigured,
  isTransferStorageConfigured,
} from "@/lib/platform/r2.server";
import { getRedis, getRedisRestConfig } from "@/lib/platform/redis.server";
import { describeEmailCapability } from "@/lib/platform/email.server";
import { describePaymentsCapability } from "@/lib/platform/stripe.server";
import { checkDatabase, isDatabaseConfigured } from "@/lib/platform/postgres.server";
import { getCommandRedis, getDirectRedisConfig } from "@/lib/platform/redis-direct.server";
import { hasMediaPublicUrl } from "@/lib/shared/config";
import { getRuntimeMetadata } from "@/lib/platform/runtime-metadata.server";
import { getDatabaseBootState } from "@/lib/platform/database-readiness.server";

function isConfigured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

const POSTGRES_APPLICATION_STORES = [
  "ALBUM_OBJECT_DELETION_RUNNER",
  "ALBUM_STORE",
  "ATTENDEE_SESSION_STORE",
  "AUTH_CLI_STORE",
  "AUTH_TOKEN_STORE",
  "BEST_DRESSED_STORE",
  "CENTRE_ROOM_STORE",
  "DRAW_COUNTRY_ROOM_STORE",
  "FAMILY_FEUD_ROOM_STORE",
  "GAME_POOL_CREDENTIAL_STORE",
  "HOT_AND_COLD_ROOM_STORE",
  "LIARS_ROOM_STORE",
  "MEDIA_WORKER_STATUS_STORE",
  "MULTIPLAYER_REALTIME_BACKPLANE",
  "OFFICIAL_GAME_RESULT_OUTBOX_STORE",
  "PAIRED_GAME_ROOM_STORE",
  "PASSKEY_CEREMONY_STORE",
  "PITCH_PRESENTATION_STORE",
  "RATE_LIMIT_STORE",
  "REPORT_STORE",
  "SAME_BRAIN_ROOM_STORE",
  "SPELLING_PARTY_ROOM_STORE",
  "TRANSFER_CATALOGUE_STORE",
  "TRANSFER_MEDIA_EVENT_BACKPLANE",
  "TRANSFER_MEDIA_JOB_STORE",
  "TRANSFER_OBJECT_DELETION_RUNNER",
  "TWIN_ROOM_STORE",
  "UPLOAD_ACCESS_STORE",
  "WORD_SHARE_STORE",
  "WORD_STORE",
] as const;

function postgresApplicationPersistenceSelected() {
  return POSTGRES_APPLICATION_STORES.every((name) => process.env[name] === "postgres");
}

function getConfiguredCapabilities(): Capability[] {
  const redisConfigured = getRedisRestConfig() !== null;
  const objectStorageConfigured = isObjectStorageConfigured();
  const privateTransferStorageConfigured = isTransferStorageConfigured();
  const authConfigured = getSecurityWarnings().length === 0;
  const maintenanceConfigured = isConfigured("CRON_SECRET");
  const directRedisConfigured = getDirectRedisConfig() !== null;
  const postgresRealtime = process.env.MULTIPLAYER_REALTIME_BACKPLANE === "postgres";
  const realtimeBackplaneConfigured = postgresRealtime
    ? isDatabaseConfigured()
    : directRedisConfigured;
  const emailCapability = describeEmailCapability();
  const paymentsCapability = describePaymentsCapability();
  const databaseConfigured = isDatabaseConfigured();
  const databaseBoot = getDatabaseBootState();
  const postgresPersistence = postgresApplicationPersistenceSelected() && databaseConfigured;
  const pitchDocuments = databaseBoot.status === "ready" ? databaseBoot.pitchDocuments : undefined;
  const mediaMode = getMediaProcessorMode();
  const mediaRole = getMediaRole();
  const pitchEnvironment = getPitchEnvironmentMode();
  const postgresWorker = process.env.TRANSFER_MEDIA_JOB_STORE === "postgres";
  const workerConfigured =
    mediaMode !== "local" &&
    (postgresWorker
      ? databaseConfigured &&
        process.env.MEDIA_WORKER_STATUS_STORE === "postgres" &&
        process.env.TRANSFER_CATALOGUE_STORE === "postgres" &&
        (process.env.ALBUM_STORE !== "postgres" ||
          process.env.ALBUM_OBJECT_DELETION_RUNNER === "postgres")
      : directRedisConfigured);

  return [
    {
      id: "runtime",
      label: "web runtime",
      status: "available",
      required: true,
      detail: "SSR, routes, and API handlers are running.",
    },
    {
      id: "persistence",
      label: "application data",
      status: postgresPersistence || redisConfigured ? "available" : "unavailable",
      required: true,
      detail: postgresPersistence
        ? "Postgres application stores are configured."
        : redisConfigured
          ? "Persistent application state is configured."
          : "Persistent application state is not configured.",
    },
    {
      id: "media-delivery",
      label: "media delivery",
      status: hasMediaPublicUrl() ? "available" : "unavailable",
      required: true,
      detail: hasMediaPublicUrl()
        ? "Public images and downloads have a delivery origin."
        : "Public images and downloads have no delivery origin.",
    },
    {
      id: "media-storage",
      label: "media storage",
      status:
        objectStorageConfigured && privateTransferStorageConfigured ? "available" : "unavailable",
      required: true,
      detail:
        objectStorageConfigured && privateTransferStorageConfigured
          ? "Public and private media storage are configured."
          : "Public media storage or the private transfer bucket is not configured.",
    },
    {
      id: "authentication",
      label: "protected areas",
      status: authConfigured ? "available" : "unavailable",
      required: true,
      detail: authConfigured
        ? "Admin, staff, and upload access are configured."
        : "One or more protected areas are not configured.",
    },
    {
      id: "maintenance",
      label: "scheduled maintenance",
      status: maintenanceConfigured ? "available" : "degraded",
      required: false,
      detail: maintenanceConfigured
        ? "Authenticated cleanup jobs can run from any scheduler."
        : "The app works, but automated cleanup is not configured.",
    },
    {
      id: "application-database",
      label: "events, tickets and pitches",
      status:
        databaseConfigured &&
        databaseBoot.status === "ready" &&
        (pitchDocuments?.unsupported ?? 0) === 0
          ? "available"
          : "unavailable",
      required: mediaRole === "web",
      detail: !databaseConfigured
        ? "DATABASE_URL is not set; events, ticketing and pitches cannot run."
        : databaseBoot.status === "failed"
          ? `Database migrations failed (${databaseBoot.reason}).`
          : databaseBoot.status === "ready"
            ? pitchDocuments
              ? `Events, tickets, pitches and redemptions are configured. Pitch documents: ${pitchDocuments.current}/${pitchDocuments.total} use schema ${pitchDocuments.currentVersion}.`
              : "Events, tickets, pitches and redemptions are configured."
            : "Database migrations have not completed.",
    },
    {
      id: "payments",
      label: "ticket payments",
      status: paymentsCapability.configured
        ? paymentsCapability.testMode
          ? "degraded"
          : "available"
        : "degraded",
      required: false,
      detail:
        paymentsCapability.problems.length > 0
          ? paymentsCapability.problems.join("; ")
          : paymentsCapability.configured
            ? paymentsCapability.testMode
              ? "Stripe is in TEST mode — no real money will move."
              : "Stripe Checkout and refunds are live."
            : `Free tickets work; paid tickets need ${paymentsCapability.missing.join(" and ")}.`,
    },
    {
      id: "ticket-email",
      label: "transactional email",
      status: emailCapability.configured ? "available" : "degraded",
      required: false,
      detail: !emailCapability.configured
        ? "Ticket and studio email channels are not fully configured."
        : `Ticket and studio emails send via ${emailCapability.provider} from ${emailCapability.senders.tickets} and ${emailCapability.senders.studio}; replies go to ${emailCapability.replyTo}.`,
    },
    {
      id: "email-delivery-events",
      label: "email delivery events",
      status: !emailCapability.configured
        ? "disabled"
        : emailCapability.deliveryEventsConfigured
          ? "available"
          : "degraded",
      required: false,
      detail: !emailCapability.configured
        ? "Delivery events wait for transactional email configuration."
        : emailCapability.deliveryEventsConfigured
          ? emailCapability.provider === "mailpit"
            ? "Local delivery is visible in Mailpit; no external event relay is needed."
            : "Normalized provider events update delivered, deferred, failed, bounced, and complaint state."
          : "Email can send, but the provider delivery-event relay secret is not configured.",
    },
    {
      id: "email-link-engagement",
      label: "email link engagement",
      status: !emailCapability.configured
        ? "disabled"
        : emailCapability.linkTrackingConfigured
          ? "available"
          : "degraded",
      required: false,
      detail: !emailCapability.configured
        ? "Link engagement waits for transactional email configuration."
        : emailCapability.linkTrackingConfigured
          ? "First-party signed redirects count meaningful clicks without exposing recipient addresses."
          : "Email can send, but AUTH_SECRET is required to sign engagement links.",
    },
    {
      id: "multiplayer-realtime",
      label: "multiplayer fan-out",
      status: realtimeBackplaneConfigured ? "available" : "degraded",
      required: false,
      detail: realtimeBackplaneConfigured
        ? "Cross-replica multiplayer wake delivery is configured."
        : postgresRealtime
          ? "Postgres multiplayer wake delivery needs DATABASE_URL."
          : "Multiplayer wake delivery is local to one replica; set REDIS_URL before scaling replicas.",
    },
    {
      id: "pitch-studio",
      label: "Pitch Night Studio",
      status:
        !pitchEnvironment.valid || pitchEnvironment.mode === "off"
          ? "disabled"
          : pitchEnvironment.mode === "read-only"
            ? "degraded"
            : "available",
      required: false,
      detail: !pitchEnvironment.valid
        ? "PITCHES_MODE is invalid, so the studio fails closed."
        : pitchEnvironment.mode === "off"
          ? "The environment safety switch stops the studio."
          : pitchEnvironment.mode === "read-only"
            ? "The environment safety switch allows reads but blocks server saves and uploads."
            : "The environment allows the admin operating mode to control the studio.",
    },
    {
      id: "media-worker",
      label: "advanced media processing",
      status: mediaMode === "local" ? "disabled" : workerConfigured ? "available" : "degraded",
      required: false,
      detail:
        mediaMode === "local"
          ? "RAW and video derivatives are processed inline; no worker queue is in use."
          : workerConfigured
            ? `RAW and video derivatives are queued for the media worker (this instance runs the ${mediaRole} role).`
            : postgresWorker
              ? "Postgres worker processing needs DATABASE_URL and matching catalogue/status stores."
              : "Worker processing is selected but REDIS_URL is missing, so the queue cannot be claimed.",
    },
  ];
}

function getOverallStatus(capabilities: Capability[]): SystemCapabilities["status"] {
  if (
    capabilities.some((capability) => capability.required && capability.status === "unavailable")
  ) {
    return "unhealthy";
  }
  if (capabilities.some((capability) => capability.required && capability.status === "degraded")) {
    return "degraded";
  }
  return "healthy";
}

function getSystemCapabilities(): SystemCapabilities {
  const capabilities = getConfiguredCapabilities();
  return {
    status: getOverallStatus(capabilities),
    timestamp: new Date().toISOString(),
    runtime: getRuntimeMetadata(),
    capabilities,
  };
}

function getMediaWorkerCapabilities(): SystemCapabilities {
  const redisRestConfigured = getRedisRestConfig() !== null;
  const directRedisConfigured = getDirectRedisConfig() !== null;
  const postgresWorker = process.env.TRANSFER_MEDIA_JOB_STORE === "postgres";
  const postgresWorkerConfigured =
    isDatabaseConfigured() &&
    process.env.MEDIA_WORKER_STATUS_STORE === "postgres" &&
    process.env.TRANSFER_CATALOGUE_STORE === "postgres" &&
    (process.env.ALBUM_STORE !== "postgres" ||
      process.env.ALBUM_OBJECT_DELETION_RUNNER === "postgres");
  const privateStorageConfigured = isPrivateStorageConfigured();
  const albumDeletionConfigured =
    process.env.ALBUM_OBJECT_DELETION_RUNNER !== "postgres" || isObjectStorageConfigured();
  const mediaMode = getMediaProcessorMode();

  const capabilities: Capability[] = [
    {
      id: "runtime",
      label: "worker runtime",
      status: "available",
      required: true,
      detail: "The media worker process is running.",
    },
    {
      id: "worker-queue",
      label: "media queue",
      status:
        mediaMode === "hybrid" &&
        (postgresWorker ? postgresWorkerConfigured : directRedisConfigured && redisRestConfigured)
          ? "available"
          : "unavailable",
      required: true,
      detail:
        mediaMode !== "hybrid"
          ? "MEDIA_PROCESSOR_MODE must be hybrid for a worker service."
          : postgresWorker
            ? postgresWorkerConfigured
              ? "Postgres media jobs, catalogue and worker status are configured."
              : "Postgres media jobs need DATABASE_URL and matching catalogue/status stores."
            : directRedisConfigured && redisRestConfigured
              ? "The worker has both blocking-queue and transfer-state Redis connections."
              : "The worker needs REDIS_URL and REDIS_REST_URL/REDIS_REST_TOKEN.",
    },
    {
      id: "media-storage",
      label: "media storage",
      status: privateStorageConfigured && albumDeletionConfigured ? "available" : "unavailable",
      required: true,
      detail: !privateStorageConfigured
        ? "Private transfer storage is not configured."
        : !albumDeletionConfigured
          ? "Album deletion requires public object-storage credentials."
          : "Worker object storage is configured.",
    },
  ];

  return {
    status: getOverallStatus(capabilities),
    timestamp: new Date().toISOString(),
    runtime: getRuntimeMetadata(),
    capabilities,
  };
}

async function probeMediaWorkerCapabilities(): Promise<SystemCapabilities> {
  const snapshot = getMediaWorkerCapabilities();
  const capabilities = [...snapshot.capabilities];

  const queueIndex = capabilities.findIndex(({ id }) => id === "worker-queue");
  if (queueIndex >= 0 && capabilities[queueIndex]?.status === "available") {
    if (process.env.TRANSFER_MEDIA_JOB_STORE === "postgres") {
      const probe = await checkDatabase();
      capabilities[queueIndex] = {
        ...capabilities[queueIndex],
        status: probe.ok ? "available" : "unavailable",
        latencyMs: probe.latencyMs,
        detail: probe.ok
          ? "Postgres media queue is reachable."
          : "Postgres media queue is configured but unreachable.",
      };
    } else {
      try {
        const directRedis = getCommandRedis() as unknown as {
          get: (key: string) => Promise<unknown>;
        };
        await Promise.all([
          getRedis()?.get("mah:health:probe"),
          directRedis.get("mah:health:probe"),
        ]);
        capabilities[queueIndex] = {
          ...capabilities[queueIndex],
          detail: "Blocking queue and transfer-state Redis connections are reachable.",
        };
      } catch {
        capabilities[queueIndex] = {
          ...capabilities[queueIndex],
          status: "unavailable",
          detail: "The worker Redis connections are configured but unreachable.",
        };
      }
    }
  }

  return {
    ...snapshot,
    status: getOverallStatus(capabilities),
    timestamp: new Date().toISOString(),
    capabilities,
  };
}

async function probeSystemCapabilities(): Promise<
  SystemCapabilities & {
    multiplayer: MultiplayerTelemetrySnapshot;
    securityWarnings: string[];
  }
> {
  const snapshot = getSystemCapabilities();
  const capabilities = [...snapshot.capabilities];
  let databaseProbe: Awaited<ReturnType<typeof checkDatabase>> | null = null;

  const persistenceIndex = capabilities.findIndex(({ id }) => id === "persistence");
  if (persistenceIndex >= 0 && capabilities[persistenceIndex]?.status === "available") {
    const startedAt = Date.now();
    if (postgresApplicationPersistenceSelected()) {
      databaseProbe = await checkDatabase();
      capabilities[persistenceIndex] = {
        ...capabilities[persistenceIndex],
        status: databaseProbe.ok ? "available" : "unavailable",
        latencyMs: databaseProbe.latencyMs,
        detail: databaseProbe.ok
          ? "Postgres application stores are reachable."
          : "Postgres application stores are configured but unreachable.",
      };
    } else {
      try {
        await getRedis()?.get("mah:health:probe");
        capabilities[persistenceIndex] = {
          ...capabilities[persistenceIndex],
          latencyMs: Date.now() - startedAt,
          detail: "Persistent application state is reachable.",
        };
      } catch {
        capabilities[persistenceIndex] = {
          ...capabilities[persistenceIndex],
          status: "unavailable",
          latencyMs: Date.now() - startedAt,
          detail: "Persistent application state is configured but unreachable.",
        };
      }
    }
  }

  if (getDirectRedisConfig()) {
    try {
      const redis = getCommandRedis() as unknown as {
        config: (command: "GET", key: string) => Promise<unknown>;
        info: (section: "memory") => Promise<string>;
      };
      const response = await redis.config("GET", "maxmemory-policy");
      let policy = Array.isArray(response) ? response.at(-1) : null;
      if (typeof policy !== "string") {
        const memory = await redis.info("memory");
        policy = memory
          .split("\n")
          .find((line) => line.startsWith("maxmemory_policy:"))
          ?.slice("maxmemory_policy:".length)
          .trim();
      }
      capabilities.push({
        id: "redis-eviction",
        label: "active room eviction",
        status: policy === "noeviction" ? "available" : "degraded",
        required: false,
        detail:
          policy === "noeviction"
            ? "Redis uses noeviction, so active room keys are not silently removed."
            : `Redis eviction policy is ${String(policy ?? "unknown")}; use noeviction for active rooms.`,
      });
    } catch {
      capabilities.push({
        id: "redis-eviction",
        label: "active room eviction",
        status: "degraded",
        required: false,
        detail: "The provider did not allow an eviction-policy check. Confirm noeviction manually.",
      });
    }
  }

  const databaseIndex = capabilities.findIndex(({ id }) => id === "application-database");
  if (databaseIndex >= 0 && capabilities[databaseIndex]?.status === "available") {
    const probe = databaseProbe ?? (await checkDatabase());
    capabilities[databaseIndex] = {
      ...capabilities[databaseIndex],
      status: probe.ok ? "available" : "unavailable",
      latencyMs: probe.latencyMs,
      detail: probe.ok
        ? "Events and ticketing storage is reachable."
        : "Events and ticketing storage is configured but unreachable.",
    };
  }

  if (process.env.MULTIPLAYER_REALTIME_BACKPLANE === "postgres") {
    const realtimeIndex = capabilities.findIndex(({ id }) => id === "multiplayer-realtime");
    const database = capabilities[databaseIndex];
    if (realtimeIndex >= 0 && database?.status === "unavailable")
      capabilities[realtimeIndex] = {
        ...capabilities[realtimeIndex],
        status: "degraded",
        detail: "Postgres multiplayer wake delivery is configured but the database is unavailable.",
      };
  }

  const storageIndex = capabilities.findIndex(({ id }) => id === "media-storage");
  if (storageIndex >= 0 && capabilities[storageIndex]?.status === "available") {
    const startedAt = Date.now();
    try {
      await checkObjectStorage();
      capabilities[storageIndex] = {
        ...capabilities[storageIndex],
        latencyMs: Date.now() - startedAt,
        detail: "Media storage is reachable.",
      };
    } catch {
      capabilities[storageIndex] = {
        ...capabilities[storageIndex],
        status: "unavailable",
        latencyMs: Date.now() - startedAt,
        detail: "Media storage is configured but unreachable.",
      };
    }
  }

  return {
    ...snapshot,
    status: getOverallStatus(capabilities),
    timestamp: new Date().toISOString(),
    capabilities,
    multiplayer: await multiplayerTelemetrySnapshot(),
    securityWarnings: getSecurityWarnings(),
  };
}

export {
  getMediaWorkerCapabilities,
  getSystemCapabilities,
  probeMediaWorkerCapabilities,
  probeSystemCapabilities,
};
