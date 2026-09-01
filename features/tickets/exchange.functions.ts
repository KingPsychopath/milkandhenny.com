import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { runEventOperationsResult } from "@/features/event-operations/runtime.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getTicketExchangeManagement, type ExchangeOutcome } from "./exchange.server";
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
    const outcome = await runEventOperationsResult(
      Effect.gen(function* () {
        const operations = yield* EventOperationsService;
        return yield* operations.startExchange({
          ...data,
          actorType: "purchaser",
          origin: getBaseUrlForRequest(getRequest()),
        });
      }),
    );
    if (!outcome.ok) return { ok: false, error: outcome.error };
    const result = outcome.value;
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, ...result.value };
  });

export type TicketExchangeOutcomeResult = ExchangeOutcome;

export const getTicketExchangeOutcomeFn = createServerFn({ method: "GET" })
  .validator((data: { exchangeId: string; sessionId?: string }) => data)
  .handler(async ({ data }): Promise<TicketExchangeOutcomeResult> => {
    const outcome = await runEventOperationsResult(
      Effect.gen(function* () {
        const operations = yield* EventOperationsService;
        return yield* operations.resolveExchange({
          ...data,
          origin: getBaseUrlForRequest(getRequest()),
        });
      }),
    );
    return outcome.ok ? outcome.value : { state: "failed", message: outcome.error };
  });
