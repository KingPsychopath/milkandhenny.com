import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";

import { openAttendeeTicket } from "@/features/event-scoring/session.server";
import { personalScore } from "@/features/event-scoring/scoring.server";
import { findSettings, privateOrderScore } from "@/features/event-scoring/store.server";
import { getEventAlbumView } from "@/features/events/drop.server";
import { EventsService } from "@/features/events/events-service.server";
import {
  toTicketHolderEvent,
  type EventAlbumView,
  type EventRecord,
} from "@/features/events/types";
import { listCheckpoints } from "@/features/tickets/checkpoints.server";
import { rememberTicketHolder } from "@/features/tickets/holder-cookie.server";
import {
  readManagedTicketOrders,
  rememberManagedTicketOrder,
} from "@/features/tickets/order-cookie.server";
import { resolveTicketOrderAccess } from "@/features/tickets/order-access";
import { buildTicketQrPayload } from "@/features/tickets/qr.server";
import { TicketsService } from "@/features/tickets/tickets-service.server";
import type { OrderTicketView, TicketPageTicket } from "@/features/tickets/types";
import { runEventOperationsResult } from "./runtime.server";

export type TicketPageResult =
  | { found: false }
  | {
      found: true;
      ticket: TicketPageTicket;
      qrPayload: string;
      event: ReturnType<typeof toTicketHolderEvent>;
      orderTickets: OrderTicketView[];
      orderSize: number;
      orderPosition: number;
      canManageOrder: boolean;
      managerTicketId?: string;
      checkpointNames: string[];
      album: EventAlbumView;
      score?: {
        participantId: string;
        publicAlias: string;
        displayMode: "alias" | "anonymous" | "hidden";
        points: number;
        revision: number;
        rank: number;
        teamRank?: number;
        synchronizedAt: string;
        orderPoints?: number;
        transactions: Array<{
          status: string;
          reasonCode: string;
          points: number;
          createdAt: string;
        }>;
      };
    };

export const getTicketPageFn = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<TicketPageResult> => {
    const loaded = await runEventOperationsResult(
      Effect.gen(function* () {
        const tickets = yield* TicketsService;
        return yield* tickets.read(data.id);
      }),
    );
    if (!loaded.ok || !loaded.value) return { found: false };

    const ticket = loaded.value;
    const detailResult = await runEventOperationsResult(
      Effect.gen(function* () {
        const events = yield* EventsService;
        const tickets = yield* TicketsService;
        const event = yield* events.read(ticket.eventSlug);
        const orderTickets = yield* tickets.order(ticket.orderId);
        return { event, orderTickets };
      }),
    );
    if (!detailResult.ok || !detailResult.value.event) return { found: false };

    const event: EventRecord = detailResult.value.event;
    const orderTickets = detailResult.value.orderTickets;
    const access = resolveTicketOrderAccess(ticket, orderTickets, readManagedTicketOrders());
    const isPrimaryTicket = access.managerTicketId === ticket.id;

    rememberTicketHolder(event.slug);
    if (isPrimaryTicket) rememberManagedTicketOrder(ticket.orderId);

    const [album, checkpoints] = await Promise.all([
      getEventAlbumView(event.slug),
      listCheckpoints(event.slug),
    ]);
    const scoringSettings = await findSettings(event.slug);
    const scoreResult =
      scoringSettings && scoringSettings.state !== "off"
        ? await personalScore({
            eventSlug: event.slug,
            ticketId: ticket.id,
            includeHistory: true,
          })
        : null;
    const orderScore =
      scoreResult?.ok && access.canManageOrder
        ? await privateOrderScore({ eventSlug: event.slug, orderId: ticket.orderId })
        : null;
    if (scoreResult) {
      try {
        await openAttendeeTicket({ ticketId: ticket.id, eventSlug: event.slug, mode: "view-only" });
      } catch {
        // Ticket rendering must survive an unavailable optional scoring session store.
      }
    }

    return {
      found: true,
      ticket: {
        id: ticket.id,
        holderName: ticket.holderName,
        kind: ticket.kind,
        status: ticket.status,
        redeemedAt: ticket.redeemedAt,
        amountPaidMinor: ticket.amountPaidMinor,
        currency: ticket.currency,
      },
      qrPayload: buildTicketQrPayload(ticket.id),
      event: toTicketHolderEvent(event),
      orderTickets: access.tickets.map(
        ({ id, holderName, status, redeemedAt, amountPaidMinor, currency }) => ({
          id,
          holderName,
          status,
          redeemedAt,
          amountPaidMinor,
          currency,
        }),
      ),
      orderSize: access.orderSize,
      orderPosition: access.orderPosition,
      canManageOrder: access.canManageOrder,
      managerTicketId: access.managerTicketId,
      checkpointNames: checkpoints.map((checkpoint) => checkpoint.name),
      album,
      score: scoreResult?.ok
        ? {
            participantId: scoreResult.value.participant.id,
            publicAlias: scoreResult.value.participant.publicAlias,
            displayMode: scoreResult.value.participant.displayMode,
            points: scoreResult.value.participant.balance,
            revision: scoreResult.value.participant.revision,
            rank: scoreResult.value.rank,
            teamRank: scoreResult.value.teamRank,
            synchronizedAt: new Date().toISOString(),
            transactions: scoreResult.value.transactions,
            orderPoints: orderScore?.ok ? orderScore.value.points : undefined,
          }
        : undefined,
    };
  });
