export interface GameContext {
  readonly now: number;
  readonly randomValues: readonly number[];
  readonly newId: string;
}

export interface VersionedGameCommand<Game extends string, Action, Actor = string> {
  readonly schemaVersion: 1;
  readonly game: Game;
  readonly actionId: string;
  readonly actor: Actor;
  readonly action: Action;
}

export interface VersionedGameEvent<Game extends string, Type extends string = string> {
  readonly schemaVersion: 1;
  readonly game: Game;
  readonly type: Type;
  readonly actionId: string;
  readonly occurredAt: number;
}

export type GameResult<Value, Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Error };

export interface GameTransition<State, Event, Output = void> {
  readonly state: State;
  readonly events: readonly Event[];
  readonly output?: Output;
}

export interface ReplayableGameState {
  readonly processedActions: readonly string[];
}

export type GameRuleError<Code extends string = string> = {
  readonly code: Code;
  readonly message: string;
};

/**
 * Pure shell used by authoritative room reducers. The reducer may mutate only the structured clone
 * it receives; persistence, publication, logging, and ID generation stay outside this function.
 */
export function applyGameCommand<
  State extends ReplayableGameState,
  Game extends string,
  Action,
  Actor,
  Output,
  DomainEvent extends VersionedGameEvent<Game> = never,
>(
  state: State,
  command: VersionedGameCommand<Game, Action, Actor>,
  context: GameContext,
  reduce: (
    draft: State,
    command: VersionedGameCommand<Game, Action, Actor>,
    context: GameContext,
    emit: (event: DomainEvent) => void,
  ) => Output,
): GameResult<
  GameTransition<
    State,
    | VersionedGameEvent<Game, "command.accepted" | "command.replayed" | "command.rejected">
    | DomainEvent,
    Output
  >,
  never
>;
export function applyGameCommand<
  State extends ReplayableGameState,
  Game extends string,
  Action,
  Actor,
  Output,
  DomainEvent extends VersionedGameEvent<Game> = never,
>(
  state: State,
  command: VersionedGameCommand<Game, Action, Actor>,
  context: GameContext,
  reduce: (
    draft: State,
    command: VersionedGameCommand<Game, Action, Actor>,
    context: GameContext,
    emit: (event: DomainEvent) => void,
  ) => Output,
) {
  const draft = structuredClone(state);
  const events: DomainEvent[] = [];
  const seenBefore = draft.processedActions.includes(command.actionId);
  const output = reduce(draft, command, context, (event) => events.push(event));
  const seenAfter = draft.processedActions.includes(command.actionId);
  const type = seenBefore
    ? "command.replayed"
    : seenAfter
      ? "command.accepted"
      : "command.rejected";
  return {
    ok: true as const,
    value: {
      state: draft,
      events: [
        ...events,
        gameCommandEvent({ game: command.game, type, actionId: command.actionId, context }),
      ],
      output,
    },
  };
}

export function versionGameCommand<Game extends string, Action, Actor>(input: {
  game: Game;
  actionId: string;
  actor: Actor;
  action: Action;
}): VersionedGameCommand<Game, Action, Actor> {
  return { schemaVersion: 1, ...input };
}

export function gameCommandEvent<Game extends string>(input: {
  game: Game;
  type: "command.accepted" | "command.replayed" | "command.rejected";
  actionId: string;
  context: GameContext;
}): VersionedGameEvent<Game, "command.accepted" | "command.replayed" | "command.rejected"> {
  return {
    schemaVersion: 1,
    game: input.game,
    type: input.type,
    actionId: input.actionId,
    occurredAt: input.context.now,
  };
}

/** Copies a pure transition result into the persistence-owned aggregate instance. */
export function replaceGameState<State extends object>(target: State, next: State): void {
  for (const key of Object.keys(target) as Array<keyof State>) delete target[key];
  Object.assign(target, next);
}

export function gameTransition<State, Event>(
  state: State,
  events: readonly Event[] = [],
): GameResult<GameTransition<State, Event>, never> {
  return { ok: true, value: { state, events } };
}

export function gameRuleFailure<Error>(error: Error): GameResult<never, Error> {
  return { ok: false, error };
}

export function gameRandomInt(context: GameContext) {
  let cursor = 0;
  return (upperBound: number) => {
    if (!Number.isInteger(upperBound) || upperBound <= 0)
      throw new RangeError("Random upper bound must be a positive integer");
    if (context.randomValues.length === 0)
      throw new RangeError("Game context has no random values");
    const value = context.randomValues[cursor % context.randomValues.length];
    cursor += 1;
    if (value < 0 || value >= 1) throw new RangeError("Game random values must be in [0, 1)");
    return Math.floor(value * upperBound);
  };
}
