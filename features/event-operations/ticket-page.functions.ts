import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { authenticateRequest } from "@/features/auth/auth.server";
import { queryOne } from "@/lib/platform/postgres.server";
import {
  getAttendeeSession,
  openAttendeeTicket,
  ticketPointSelection,
} from "@/features/event-scoring/session.server";
import {
  currentAttendeeTicketIdentity,
  managedOrderIdsForPerson,
} from "@/features/attendee-access/access.server";
import type { AttendeeTicketIdentity } from "@/features/attendee-access/types";
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
      attendeeIdentity?: AttendeeTicketIdentity;
      ticketPointSelection?: Awaited<ReturnType<typeof ticketPointSelection>>;
      score?: {
        participantId: string;
        publicAlias: string;
        displayMode: "alias" | "anonymous" | "hidden";
        points: number;
        revision: number;
        rank: number;
        teamRank?: number;
        leaderboardAvailable: boolean;
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
    if (!data.preview && ticket.accessReference && data.id !== ticket.accessReference) {
      const attendeeSession = await getAttendeeSession().catch(() => null);
      const personId = attendeeSession?.personId;
      const [personOwnsTicket, personManagesOrder] = personId
        ? await Promise.all([
            queryOne<{ owns: boolean }>(
              `select true as owns from event_participants
                where ticket_id = $1 and person_id = $2`,
              [ticket.id, personId],
            ),
            managedOrderIdsForPerson(personId).then((orders) => orders.includes(ticket.orderId)),
          ])
        : [null, false];
      if (!personOwnsTicket && !personManagesOrder) return { found: false };
    }
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

    const [attendeeIdentity, pointSelection] = data.preview
      ? [undefined, undefined]
      : await Promise.all([
          currentAttendeeTicketIdentity(ticket.id, event.slug).catch(() => ({
            account: null,
            personallyClaimed: false,
          })),
          ticketPointSelection(ticket.id).catch(() => ({
            mode: "view-only" as const,
            active: false,
            eventHasActive: false,
          })),
        ]);

    return {
      found: true,
      ticket: {
        id: ticket.id,
        publicId: ticket.accessReference ?? ticket.id,
        holderName: ticket.holderName,
        kind: ticket.kind,
        status: ticket.status,
        redeemedAt: ticket.redeemedAt,
        amountPaidMinor: ticket.amountPaidMinor,
        currency: ticket.currency,
      },
      qrPayload: data.preview
        ? `milkandhenny:attendee-preview:${ticket.id}`
        : buildTicketQrPayload(ticket.accessReference ?? ticket.id),
      event: toTicketHolderEvent(event),
      orderTickets: access.tickets.map(
        ({ id, accessReference, holderName, status, redeemedAt, amountPaidMinor, currency }) => ({
          id,
          publicId: accessReference ?? id,
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
      attendeeIdentity,
      ticketPointSelection: pointSelection,
      score: scoreResult?.ok
        ? {
            participantId: scoreResult.value.participant.id,
            publicAlias: scoreResult.value.participant.publicAlias,
            displayMode: scoreResult.value.participant.displayMode,
            points: scoreResult.value.participant.balance,
            revision: scoreResult.value.participant.revision,
            rank: scoreResult.value.rank,
            teamRank: scoreResult.value.teamRank,
            leaderboardAvailable:
              scoringSettings?.leaderboardVisibility === "public-live" ||
              scoringSettings?.leaderboardVisibility === "public-final",
            synchronizedAt: new Date().toISOString(),
            transactions: scoreResult.value.transactions,
            orderPoints: orderScore?.ok ? orderScore.value.points : undefined,
          }
        : undefined,
    };
  });
