import { getMediaProcessorMode } from "@/features/media/config.server";
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
import { getDirectRedisConfig } from "@/lib/platform/redis-direct.server";
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
  const mediaMode = getMediaProcessorMode();
  const mediaRole = getMediaRole();
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
      id: "events-database",
      label: "events and ticketing",
      status: databaseConfigured && databaseBoot.status === "ready" ? "available" : "unavailable",
      required: mediaRole === "web",
      detail: !databaseConfigured
        ? "DATABASE_URL is not set; events and ticketing cannot run."
        : databaseBoot.status === "failed"
          ? `Database migrations failed (${databaseBoot.reason}).`
          : databaseBoot.status === "ready"
            ? "Events, tickets and redemptions are configured."
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
      status:
        emailCapability.configured && emailCapability.feedbackConfigured ? "available" : "degraded",
      required: false,
      detail: !emailCapability.configured
        ? "Ticket and studio email channels are not fully configured."
        : !emailCapability.feedbackConfigured
          ? "Cloudflare can send, but its delivery-event relay is not configured."
          : `Ticket and studio emails send via ${emailCapability.provider} from ${emailCapability.senders.tickets} and ${emailCapability.senders.studio}; replies go to ${emailCapability.replyTo}.`,
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

  const databaseIndex = capabilities.findIndex(({ id }) => id === "events-database");
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
