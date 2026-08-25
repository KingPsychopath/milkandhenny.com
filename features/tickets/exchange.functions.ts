import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getBaseUrlForRequest } from "@/lib/shared/config";
import {
  beginTicketExchange,
  getTicketExchangeManagement,
  resolveTicketExchangeOutcome,
} from "./exchange.server";
import type { TicketExchangeManagement } from "./exchange-types";

export type TicketExchangeManagementResult =
  | { ok: true; management: TicketExchangeManagement }
  | { ok: false; error: string };

export const getTicketExchangeManagementFn = createServerFn({ method: "GET" })
  .validator((data: { managerTicketId: string }) => data)
  .handler(async ({ data }): Promise<TicketExchangeManagementResult> => {
    const result = await getTicketExchangeManagement(data);
    return result.ok ? { ok: true, management: result.value } : { ok: false, error: result.error };
  });

export type BeginTicketExchangeFnResult =
  | {
      ok: true;
      state: "completed" | "refund_pending" | "checkout";
      exchangeId: string;
      message?: string;
      url?: string;
      emailQueued?: boolean;
    }
  | { ok: false; error: string };

export const beginOwnTicketExchangeFn = createServerFn({ method: "POST" })
  .validator(
    (data: { managerTicketId: string; ticketId: string; targetTicketTypeId: string }) => data,
  )
  .handler(async ({ data }): Promise<BeginTicketExchangeFnResult> => {
    const result = await beginTicketExchange({
      ...data,
      actorType: "purchaser",
      origin: getBaseUrlForRequest(getRequest()),
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, ...result.value };
  });

export type TicketExchangeOutcomeResult = Awaited<ReturnType<typeof resolveTicketExchangeOutcome>>;

export const getTicketExchangeOutcomeFn = createServerFn({ method: "GET" })
  .validator((data: { exchangeId: string; sessionId?: string }) => data)
  .handler(
    async ({ data }): Promise<TicketExchangeOutcomeResult> =>
      resolveTicketExchangeOutcome({
        ...data,
        origin: getBaseUrlForRequest(getRequest()),
      }),
  );
