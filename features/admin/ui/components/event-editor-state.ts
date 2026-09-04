import type {
  EventRecord,
  EventStatus,
  EventHeroHeight,
  EventArrivalExperience,
  TicketType,
} from "@/features/events/types";
import { toZonedDateTimeInput, fromZonedDateTimeInput } from "@/lib/shared/zoned-datetime";

type DraftTicketType = {
  id: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  quantity: string;
  perPersonLimit: string;
  salesStart: string;
  salesEnd: string;
  hidden: boolean;
};

export type Draft = {
  expectedUpdatedAt?: string;
  slug: string;
  title: string;
  tagline: string;
  status: EventStatus;
  startsAt: string;
  doorsAt: string;
  endsAt: string;
  timezone: string;
  area: string;
  venueName: string;
  address: string;
  doorCode: string;
  threeWordHint: string;
  mapUrl: string;
  description: string;
  lineup: string;
  dressCode: string;
  ageLimit: string;
  houseRules: string;
  transportNote: string;
  stepFreeAccess: boolean;
  capacity: string;
  waitlistEnabled: boolean;
  refundPolicy: string;
  terms: string;
  heroImage: string;
  heroImageWidth: number | undefined;
  heroImageHeight: number | undefined;
  heroHeight: EventHeroHeight;
  ogImage: string;
  marketingPath: string;
  arrivalExperience: EventArrivalExperience;
  ticketTypes: DraftTicketType[];
};

export const EMPTY_DRAFT: Draft = {
  slug: "",
  title: "",
  tagline: "",
  status: "draft",
  startsAt: "",
  doorsAt: "",
  endsAt: "",
  timezone: "Europe/London",
  area: "",
  venueName: "",
  address: "",
  doorCode: "",
  threeWordHint: "",
  mapUrl: "",
  description: "",
  lineup: "",
  dressCode: "",
  ageLimit: "",
  houseRules: "",
  transportNote: "",
  stepFreeAccess: false,
  capacity: "",
  waitlistEnabled: true,
  refundPolicy: "",
  terms: "",
  heroImage: "",
  heroImageWidth: undefined,
  heroImageHeight: undefined,
  heroHeight: "natural",
  ogImage: "",
  marketingPath: "",
  arrivalExperience: "none",
  ticketTypes: [
    {
      id: "standard",
      name: "Entry",
      description: "",
      price: "0",
      currency: "GBP",
      quantity: "50",
      perPersonLimit: "2",
      salesStart: "",
      salesEnd: "",
      hidden: false,
    },
  ],
};

export function toDraft(event: EventRecord): Draft {
  return {
    expectedUpdatedAt: event.updatedAt,
    slug: event.slug,
    title: event.title,
    tagline: event.tagline ?? "",
    status: event.status,
    startsAt: toZonedDateTimeInput(event.startsAt, event.timezone),
    doorsAt: toZonedDateTimeInput(event.doorsAt, event.timezone),
    endsAt: toZonedDateTimeInput(event.endsAt, event.timezone),
    timezone: event.timezone,
    area: event.area ?? "",
    venueName: event.venueName ?? "",
    address: event.address ?? "",
    doorCode: event.doorCode ?? "",
    threeWordHint: event.threeWordHint ?? "",
    mapUrl: event.mapUrl ?? "",
    description: event.description ?? "",
    lineup: event.lineup.join(", "),
    dressCode: event.dressCode ?? "",
    ageLimit: event.ageLimit ?? "",
    houseRules: event.houseRules ?? "",
    transportNote: event.transportNote ?? "",
    stepFreeAccess: event.stepFreeAccess === true,
    capacity: event.capacity ? String(event.capacity) : "",
    waitlistEnabled: event.waitlistEnabled,
    refundPolicy: event.refundPolicy ?? "",
    terms: event.terms ?? "",
    heroImage: event.heroImage ?? "",
    heroImageWidth: event.heroImageWidth,
    heroImageHeight: event.heroImageHeight,
    heroHeight: event.heroHeight ?? "natural",
    ogImage: event.ogImage ?? "",
    marketingPath: event.marketingPath ?? "",
    arrivalExperience: event.arrivalExperience ?? "none",
    ticketTypes: event.ticketTypes.map((type) => ({
      id: type.id,
      name: type.name,
      description: type.description ?? "",
      price: String(type.priceMinor / 100),
      currency: type.currency,
      quantity: String(type.quantity),
      perPersonLimit: String(type.perPersonLimit),
      salesStart: toZonedDateTimeInput(type.salesStart, event.timezone),
      salesEnd: toZonedDateTimeInput(type.salesEnd, event.timezone),
      hidden: type.hidden,
    })),
  };
}

export function draftToPayload(draft: Draft): Record<string, unknown> {
  const ticketTypes: Partial<TicketType>[] = draft.ticketTypes
    .filter((type) => type.name.trim())
    .map((type) => ({
      id:
        type.id.trim() ||
        type.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
      name: type.name.trim(),
      description: type.description.trim() || undefined,
      priceMinor: Math.round((Number.parseFloat(type.price) || 0) * 100),
      currency: type.currency.trim().toUpperCase() || "GBP",
      quantity: Number.parseInt(type.quantity, 10) || 0,
      perPersonLimit: Number.parseInt(type.perPersonLimit, 10) || 1,
      salesStart: fromZonedDateTimeInput(type.salesStart, draft.timezone),
      salesEnd: fromZonedDateTimeInput(type.salesEnd, draft.timezone),
      hidden: type.hidden,
    }));

  return {
    expectedUpdatedAt: draft.expectedUpdatedAt,
    slug: draft.slug.trim() || undefined,
    title: draft.title.trim(),
    tagline: draft.tagline.trim() || null,
    status: draft.status,
    startsAt: fromZonedDateTimeInput(draft.startsAt, draft.timezone),
    doorsAt: fromZonedDateTimeInput(draft.doorsAt, draft.timezone) ?? null,
    endsAt: fromZonedDateTimeInput(draft.endsAt, draft.timezone) ?? null,
    timezone: draft.timezone.trim(),
    area: draft.area.trim() || null,
    venueName: draft.venueName.trim() || null,
    address: draft.address.trim() || null,
    doorCode: draft.doorCode.trim() || null,
    threeWordHint: draft.threeWordHint.trim() || null,
    mapUrl: draft.mapUrl.trim() || null,
    description: draft.description.trim() || null,
    lineup: draft.lineup
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    dressCode: draft.dressCode.trim() || null,
    ageLimit: draft.ageLimit.trim() || null,
    houseRules: draft.houseRules.trim() || null,
    transportNote: draft.transportNote.trim() || null,
    stepFreeAccess: draft.stepFreeAccess,
    capacity: draft.capacity ? Number.parseInt(draft.capacity, 10) : null,
    waitlistEnabled: draft.waitlistEnabled,
    refundPolicy: draft.refundPolicy.trim() || null,
    terms: draft.terms.trim() || null,
    heroImage: draft.heroImage.trim() || null,
    heroImageWidth: draft.heroImage.trim() ? draft.heroImageWidth : null,
    heroImageHeight: draft.heroImage.trim() ? draft.heroImageHeight : null,
    heroHeight: draft.heroHeight,
    ogImage: draft.ogImage.trim() || null,
    marketingPath: draft.marketingPath.trim() || null,
    arrivalExperience: draft.arrivalExperience,
    ticketTypes,
  };
}
