import { Context, Effect, Layer } from "effect";

import { eventsOperation } from "@/features/events/events-operation.server";
import { withPostgresProvider } from "@/lib/platform/postgres-provider-context.server";
import { PostgresService } from "@/lib/platform/provider-services.server";
import { addEventIcebreakerEncounter, getEventIcebreaker } from "./event-icebreaker.server";

export class EventIcebreakerService extends Context.Service<
  EventIcebreakerService,
  {
    readonly encounter: (
      input: Parameters<typeof addEventIcebreakerEncounter>[0],
    ) => ReturnType<
      typeof eventsOperation<Awaited<ReturnType<typeof addEventIcebreakerEncounter>>>
    >;
    readonly get: (
      ...input: Parameters<typeof getEventIcebreaker>
    ) => ReturnType<typeof eventsOperation<Awaited<ReturnType<typeof getEventIcebreaker>>>>;
  }
>()("EventIcebreakerService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const postgres = yield* PostgresService;
      return {
        encounter: (input) =>
          eventsOperation(
            {
              domain: "event-scoring",
              operation: "icebreaker_encounter",
              kind: "idempotent-mutation",
              timeoutMs: 15_000,
            },
            () => withPostgresProvider(postgres.port, () => addEventIcebreakerEncounter(input)),
          ),
        get: (...input) =>
          eventsOperation(
            {
              domain: "event-scoring",
              operation: "icebreaker_get",
              kind: "idempotent-mutation",
              timeoutMs: 10_000,
            },
            () => withPostgresProvider(postgres.port, () => getEventIcebreaker(...input)),
          ),
      };
    }),
  );
}
