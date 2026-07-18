import { getMediaProcessorMode } from "@/features/media/config.server";
import type { Capability, SystemCapabilities } from "@/features/system/capabilities";
import { multiplayerTelemetrySnapshot } from "@/features/things/shared/multiplayer-runtime.server";
import type { MultiplayerTelemetrySnapshot } from "@/features/things/shared/multiplayer-telemetry";
import { getSecurityWarnings } from "@/features/auth/auth.server";
import {
  checkConnection as checkObjectStorage,
  isConfigured as isObjectStorageConfigured,
  isTransferStorageConfigured,
} from "@/lib/platform/r2.server";
import { getRedis, getRedisRestConfig } from "@/lib/platform/redis.server";
import { getDirectRedisConfig } from "@/lib/platform/redis-direct.server";
import { hasMediaPublicUrl } from "@/lib/shared/config";
import { getRuntimeMetadata } from "@/lib/platform/runtime-metadata.server";

const REQUIRED_AUTH_VARIABLES = [
  "AUTH_SECRET",
  "ADMIN_PASSWORD",
  "STAFF_PIN",
  "UPLOAD_PIN",
] as const;

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
  const mediaMode = getMediaProcessorMode();
  const workerConfigured =
    mediaMode !== "local" &&
    isConfigured("TRANSFER_MEDIA_WAKE_URL") &&
    isConfigured("TRANSFER_MEDIA_WAKE_TOKEN");

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
          ? "The optional RAW and video worker is intentionally disabled."
          : workerConfigured
            ? "The optional media worker wake path is configured."
            : "Worker processing is selected but its wake path is incomplete.",
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
