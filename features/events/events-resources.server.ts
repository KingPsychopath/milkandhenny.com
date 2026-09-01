import { Context, Data, Effect, Layer, Queue } from "effect";

import {
  closeScoreEventSubscriber,
  reconnectScoreEventSubscriber,
  setScoreEventReconnectWake,
  subscribeToScoreEvents,
} from "@/features/event-scoring/score-events.server";
import {
  closeTicketEventSubscriber,
  reconnectTicketEventSubscriber,
  setTicketEventReconnectWake,
  subscribeToTicketEvents,
} from "@/features/tickets/ticket-events.server";
import { log } from "@/lib/platform/logger.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { withPostgresProvider } from "@/lib/platform/postgres-provider-context.server";
import { PostgresService } from "@/lib/platform/provider-services.server";

export class EventsRealtimeError extends Data.TaggedError("EventsRealtimeError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, run),
    catch: (cause) => new EventsRealtimeError({ cause, operation }),
  }).pipe(Effect.withSpan(`events.realtime.${operation}`));
}

function reconnectLoop(
  queue: Queue.Queue<void>,
  reconnect: () => Promise<void>,
  channel: "score" | "ticket",
) {
  return Effect.forever(
    Queue.take(queue).pipe(
      Effect.andThen(Effect.sleep(1_000)),
      Effect.andThen(attempt(`${channel}_reconnect`, reconnect)),
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn("events.realtime", "Realtime subscriber reconnect will retry", {
            channel,
            error: String(error),
          });
          Effect.runSync(Queue.offer(queue, undefined));
        }),
      ),
    ),
  );
}

/** Effect owns the shared Postgres subscriber lifecycle and reconnect schedules. */
export class EventsRealtimeService extends Context.Service<
  EventsRealtimeService,
  {
    readonly subscribeScore: (
      ...args: Parameters<typeof subscribeToScoreEvents>
    ) => Effect.Effect<() => void, EventsRealtimeError>;
    readonly subscribeTicket: (
      ...args: Parameters<typeof subscribeToTicketEvents>
    ) => Effect.Effect<() => void, EventsRealtimeError>;
  }
>()("EventsRealtimeService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const postgres = yield* PostgresService;
      const scoreReconnects = yield* Queue.sliding<void>(1);
      const ticketReconnects = yield* Queue.sliding<void>(1);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          setScoreEventReconnectWake(() => {
            Effect.runSync(Queue.offer(scoreReconnects, undefined));
          });
          setTicketEventReconnectWake(() => {
            Effect.runSync(Queue.offer(ticketReconnects, undefined));
          });
        }),
        () =>
          Effect.sync(() => {
            setScoreEventReconnectWake(null);
            setTicketEventReconnectWake(null);
          }).pipe(
            Effect.andThen(
              Effect.promise(() =>
                Promise.allSettled([
                  closeScoreEventSubscriber(),
                  closeTicketEventSubscriber(),
                ]).then(() => undefined),
              ),
            ),
          ),
      );

      yield* Effect.all(
        [
          reconnectLoop(
            scoreReconnects,
            () => withPostgresProvider(postgres.port, reconnectScoreEventSubscriber),
            "score",
          ),
          reconnectLoop(
            ticketReconnects,
            () => withPostgresProvider(postgres.port, reconnectTicketEventSubscriber),
            "ticket",
          ),
        ],
        { concurrency: 2, discard: true },
      ).pipe(Effect.forkScoped);

      return {
        subscribeScore: (...args: Parameters<typeof subscribeToScoreEvents>) =>
          attempt("score_subscribe", () =>
            withPostgresProvider(postgres.port, () => subscribeToScoreEvents(...args)),
          ),
        subscribeTicket: (...args: Parameters<typeof subscribeToTicketEvents>) =>
          attempt("ticket_subscribe", () =>
            withPostgresProvider(postgres.port, () => subscribeToTicketEvents(...args)),
          ),
      };
    }),
  );
}
