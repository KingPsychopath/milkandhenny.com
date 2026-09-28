import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import {
  isEmailChannel,
  isEmailDeliveryStatus,
  isEmailKind,
  isEmailOutboxStatus,
  isEmailSource,
} from "@/lib/shared/email-operations";
import { listEmailLedger } from "./email-operations.server";
import type { EmailLedgerQuery, EmailLedgerSort } from "./types";

const SORTS: EmailLedgerSort[] = ["newest", "oldest", "next-attempt"];

export const getAdminEmailLedgerFn = createServerFn({ method: "GET" })
  .validator((input: EmailLedgerQuery) => ({
    page: Number.isInteger(input.page) ? Math.min(10_000, Math.max(1, input.page)) : 1,
    limit: Number.isInteger(input.limit) ? Math.min(100, Math.max(1, input.limit)) : 40,
    sort: SORTS.includes(input.sort) ? input.sort : ("newest" as const),
    query: input.query?.trim().slice(0, 200) || undefined,
    channel: isEmailChannel(input.channel ?? null) ? input.channel : undefined,
    status: isEmailOutboxStatus(input.status ?? null) ? input.status : undefined,
    deliveryStatus: isEmailDeliveryStatus(input.deliveryStatus ?? null)
      ? input.deliveryStatus
      : undefined,
    kind: isEmailKind(input.kind ?? null) ? input.kind : undefined,
    source: isEmailSource(input.source ?? null) ? input.source : undefined,
  }))
  .handler(async ({ data }) => {
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok || !access.permissions.manageCommunications)
      throw new Error("Communications access required");
    return listEmailLedger(data);
  });
