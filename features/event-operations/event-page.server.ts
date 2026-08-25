import { getEvent } from "@/features/events/store.server";
import {
  isPubliclyVisible,
  ticketTypeSalesState,
  toPublicEvent,
  toTicketHolderEvent,
  type EventRecord,
  type SalesState,
  type TicketType,
  type ViewableEvent,
} from "@/features/events/types";
import type { ResponsiveImageData } from "@/features/media/image";
import { resolveAlbumImageUrls } from "@/features/media/resolve-album-image.server";
import {
  getTicketCapacitySnapshot,
  type TicketCapacitySnapshot,
} from "@/features/tickets/capacity.server";
import { listPublishedPitches } from "@/features/things/pitches/pitches.server";
import {
  PITCH_SHOWCASE_MARKDOWN_HREF,
  type PublicPitchDeck,
} from "@/features/things/pitches/types";
import { log } from "@/lib/platform/logger.server";

export type TicketTypeAvailability = {
  type: TicketType;
  sold: number;
  remaining: number;
  sales: SalesState;
};

export function buildAvailability(
  event: EventRecord,
  capacity: TicketCapacitySnapshot,
  now = Date.now(),
): TicketTypeAvailability[] {
  const soldTotal = Object.values(capacity.sold).reduce((total, count) => total + count, 0);
  const checkoutTotal = Object.values(capacity.checkoutReserved).reduce(
    (total, count) => total + count,
    0,
  );
  const eventRemaining =
    event.capacity === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, event.capacity - soldTotal - checkoutTotal);

  return event.ticketTypes
    .filter((type) => !type.hidden)
    .map((type) => {
      const soldCount = capacity.sold[type.id] ?? 0;
      const occupied =
        soldCount +
        (capacity.checkoutReserved[type.id] ?? 0) +
        (capacity.exchangeReserved[type.id] ?? 0);
      const sales = ticketTypeSalesState(event, type, occupied, now);
      return {
        type,
        sold: soldCount,
        remaining: Math.min(Math.max(0, type.quantity - occupied), eventRemaining),
        sales: eventRemaining === 0 && sales.state === "on-sale" ? { state: "sold-out" } : sales,
      };
    });
}

export function isEventSoldOut(
  event: Pick<EventRecord, "status">,
  availability: TicketTypeAvailability[],
): boolean {
  return (
    event.status === "sold-out" ||
    (availability.length > 0 && availability.every((entry) => entry.remaining === 0))
  );
}

export type EventPageData = {
  event: ViewableEvent;
  availability: TicketTypeAvailability[];
  soldOut: boolean;
  pitchShowcase?: PublicPitchDeck[];
  heroImage?: ResponsiveImageData;
  descriptionImages: Record<string, ResponsiveImageData>;
};

function markdownImageSources(markdown: string | undefined): string[] {
  if (!markdown) return [];
  return [...markdown.matchAll(/!\[[^\]]*]\((\S+?)(?:\s+["'][^"']*["'])?\)/g)].map(
    (match) => match[1],
  );
}

async function resolvePitchShowcase(description: string | undefined) {
  if (!description?.includes(`](${PITCH_SHOWCASE_MARKDOWN_HREF})`)) return undefined;

  try {
    return (await listPublishedPitches()).pitches;
  } catch (error) {
    log.warn("events.pitch_showcase", "Could not load published pitches", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Compose the public event read model without making event definitions depend on ticketing. */
export async function getEventPage(
  slug: string,
  options: { revealLocation?: boolean; includeHidden?: boolean } = {},
): Promise<EventPageData | null> {
  const event = await getEvent(slug);
  if (!event) return null;
  if (!options.includeHidden && !isPubliclyVisible(event)) return null;

  const imageSources = [event.heroImage, ...markdownImageSources(event.description)].filter(
    (source): source is string => Boolean(source),
  );
  const [capacity, pitchShowcase, images] = await Promise.all([
    getTicketCapacitySnapshot(slug),
    resolvePitchShowcase(event.description),
    resolveAlbumImageUrls(imageSources),
  ]);
  const availability = buildAvailability(event, capacity);
  return {
    event: options.revealLocation ? toTicketHolderEvent(event) : toPublicEvent(event),
    availability,
    soldOut: isEventSoldOut(event, availability),
    pitchShowcase,
    heroImage: event.heroImage ? images[event.heroImage] : undefined,
    descriptionImages: Object.fromEntries(
      Object.entries(images).filter(([source]) => source !== event.heroImage),
    ),
  };
}
