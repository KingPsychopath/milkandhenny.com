type CapabilityStatus = "available" | "degraded" | "unavailable" | "disabled";

interface Capability {
  id: string;
  label: string;
  status: CapabilityStatus;
  required: boolean;
  detail: string;
  latencyMs?: number;
}

interface SystemCapabilities {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  runtime: {
    environment: string;
    version: string;
    commit: string | null;
  };
  capabilities: Capability[];
}

export type { Capability, CapabilityStatus, SystemCapabilities };
