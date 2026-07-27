import { Context, Layer } from "effect";

import { eventsOperation } from "./events-operation.server";
import * as engine from "./events.server";
import type { EventInput } from "./events.server";

/**
 * Events service.
 *
 * The engine in `events.server.ts` owns the product rules; this layer owns
 * how those calls behave operationally — bounded, traced, typed.
 */
export class EventsService extends Context.Service<
  EventsService,
  {
    readonly create: typeof create;
    readonly update: typeof update;
    readonly remove: typeof remove;
    readonly page: typeof page;
    readonly index: typeof index;
    readonly read: typeof read;
    readonly list: typeof list;
    readonly soldCounts: typeof soldCounts;
  }
>()("EventsService") {
  static readonly layer = Layer.succeed(this, {
    create,
    update,
    remove,
    page,
    index,
    read,
    list,
    soldCounts,
  });
}

function create(input: EventInput) {
  return eventsOperation({ domain: "events", operation: "create" }, () =>
    engine.createEvent(input),
  );
}

function update(slug: string, input: EventInput) {
  return eventsOperation({ domain: "events", operation: "update" }, () =>
    engine.updateEvent(slug, input),
  );
}

function remove(slug: string) {
  return eventsOperation({ domain: "events", operation: "remove" }, () => engine.removeEvent(slug));
}

function page(slug: string, options: { revealLocation?: boolean; includeHidden?: boolean } = {}) {
  return eventsOperation({ domain: "events", operation: "page" }, () =>
    engine.getEventPage(slug, options),
  );
}

function index() {
  return eventsOperation({ domain: "events", operation: "index" }, () => engine.getEventsIndex());
}

function read(slug: string) {
  return eventsOperation({ domain: "events", operation: "read" }, () => engine.getEvent(slug));
}

function list(options: { includeHidden?: boolean } = {}) {
  return eventsOperation({ domain: "events", operation: "list" }, () => engine.listEvents(options));
}

function soldCounts(slug: string) {
  return eventsOperation({ domain: "events", operation: "sold_counts" }, () =>
    engine.getSoldCounts(slug),
  );
}
