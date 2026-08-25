import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { authenticateRequest } from "@/features/auth/auth.server";
import { getAttendeeSession, openAttendeeTicket } from "@/features/event-scoring/session.server";
import { managedOrderIdsForPerson } from "@/features/attendee-access/access.server";
import { personalScore } from "@/features/event-scoring/scoring.server";
import { listDiscoveries } from "@/features/event-scoring/discoveries.server";
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
      hasDiscoveries: boolean;
      preview?: true;
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
  .validator((data: { id: string; preview?: boolean }) => data)
  .handler(async ({ data }): Promise<TicketPageResult> => {
    if (data.preview) {
      const auth = await authenticateRequest(getRequest(), "admin");
      if (!auth.ok) return { found: false };
    }
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
    let verifiedManagedOrders: string[] = data.preview ? [ticket.orderId] : [];
    if (!data.preview) {
      try {
        const attendeeSession = await getAttendeeSession();
        verifiedManagedOrders = attendeeSession?.personId
          ? await managedOrderIdsForPerson(attendeeSession.personId)
          : [];
      } catch {
        // Existing ticket links remain usable if optional attendee access is unavailable.
      }
    }
    const access = resolveTicketOrderAccess(ticket, orderTickets, [
      ...(data.preview ? [] : readManagedTicketOrders()),
      ...verifiedManagedOrders,
    ]);
    const isPrimaryTicket = access.managerTicketId === ticket.id;

    if (!data.preview) {
      rememberTicketHolder(event.slug);
      if (isPrimaryTicket) rememberManagedTicketOrder(ticket.orderId);
    }

    const [album, checkpoints, discoveries] = await Promise.all([
      getEventAlbumView(event.slug),
      listCheckpoints(event.slug),
      listDiscoveries(event.slug),
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
    if (!data.preview) {
      try {
        await openAttendeeTicket({ ticketId: ticket.id, eventSlug: event.slug, mode: "view-only" });
      } catch {
        // Ticket rendering must survive an unavailable optional attendee session store.
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
      qrPayload: data.preview
        ? `milkandhenny:attendee-preview:${ticket.id}`
        : buildTicketQrPayload(ticket.id),
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
      hasDiscoveries: discoveries.some((discovery) => discovery.status === "live"),
      preview: data.preview ? true : undefined,
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
