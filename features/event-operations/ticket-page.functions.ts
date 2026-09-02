import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { authenticateRequest } from "@/features/auth/auth.server";
import { queryOne } from "@/lib/platform/postgres.server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import {
  currentAttendeeTicketIdentity,
  managedOrderIdsForPerson,
} from "@/features/attendee-access/access.server";
import type { AttendeeTicketIdentity } from "@/features/attendee-access/types";
import { participantForTicket } from "@/features/event-scoring/store.server";
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
import {
  runEventsResult as runEventOperationsResultWithoutSignal,
  type EventsServices,
} from "@/features/events/events-runtime.server";

function runEventOperationsResult<A, E>(effect: Effect.Effect<A, E, EventsServices>) {
  return runEventOperationsResultWithoutSignal(effect, getRequest().signal);
}

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
      team?: {
        name: string;
        colourKey?: import("@/features/event-scoring/team-palette").TeamColourKey;
      };
      preview?: true;
      attendeeIdentity?: AttendeeTicketIdentity;
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
    const publicTicketId = ticket.accessReference ?? ticket.id;
    const isPrimaryTicket = access.managerTicketId === publicTicketId;

    if (!data.preview) {
      rememberTicketHolder(event.slug);
      if (isPrimaryTicket) rememberManagedTicketOrder(ticket.orderId);
    }

    const [album, checkpoints, participant] = await Promise.all([
      getEventAlbumView(event.slug),
      listCheckpoints(event.slug),
      participantForTicket(ticket.id),
    ]);
    const attendeeIdentity = data.preview
      ? undefined
      : await currentAttendeeTicketIdentity(ticket.id, event.slug).catch(() => ({
          account: null,
          personallyClaimed: false,
        }));

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
      team: participant?.teamName
        ? { name: participant.teamName, colourKey: participant.teamColourKey }
        : undefined,
      preview: data.preview ? true : undefined,
      attendeeIdentity,
    };
  });
