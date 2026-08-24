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

const REQUIRED_AUTH_VARIABLES = ["AUTH_SECRET", "ADMIN_PASSWORD", "UPLOAD_PIN"] as const;

function isConfigured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function getConfiguredCapabilities(): Capability[] {
  const redisConfigured = getRedisRestConfig() !== null;
  const objectStorageConfigured = isObjectStorageConfigured();
  const privateTransferStorageConfigured = isTransferStorageConfigured();
  const authConfigured = REQUIRED_AUTH_VARIABLES.every(isConfigured);
  const maintenanceConfigured = isConfigured("CRON_SECRET");
  const realtimeBackplaneConfigured = getDirectRedisConfig() !== null;
  const emailCapability = describeEmailCapability();
  const paymentsCapability = describePaymentsCapability();
  const databaseConfigured = isDatabaseConfigured();
  const databaseBoot = getDatabaseBootState();
  const pitchDocuments = databaseBoot.status === "ready" ? databaseBoot.pitchDocuments : undefined;
  const mediaMode = getMediaProcessorMode();
  const mediaRole = getMediaRole();
  const pitchEnvironment = getPitchEnvironmentMode();
  // The worker claims jobs over the direct Redis connection, so that is the
  // only thing it needs configured beyond a non-local mode.
  const workerConfigured = mediaMode !== "local" && realtimeBackplaneConfigured;

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
      status: redisConfigured ? "available" : "unavailable",
      required: true,
      detail: redisConfigured
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
  if (capabilities.some((capability) => capability.status === "degraded")) {
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

async function probeSystemCapabilities(): Promise<
  SystemCapabilities & {
    multiplayer: MultiplayerTelemetrySnapshot;
    securityWarnings: string[];
  }
> {
  const snapshot = getSystemCapabilities();
  const capabilities = [...snapshot.capabilities];

  const persistenceIndex = capabilities.findIndex(({ id }) => id === "persistence");
  if (persistenceIndex >= 0 && capabilities[persistenceIndex]?.status === "available") {
    const startedAt = Date.now();
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
    const probe = await checkDatabase();
    capabilities[databaseIndex] = {
      ...capabilities[databaseIndex],
      status: probe.ok ? "available" : "unavailable",
      latencyMs: probe.latencyMs,
      detail: probe.ok
        ? "Events and ticketing storage is reachable."
        : "Events and ticketing storage is configured but unreachable.",
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

export { getSystemCapabilities, probeSystemCapabilities };
