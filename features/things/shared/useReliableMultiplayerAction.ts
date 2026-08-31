import { useRef } from "react";

const MAX_UNCERTAIN_ACTIONS = 40;
type MultiplayerActionScope = string | number | null | undefined;

export type ReliableMultiplayerActionDispatcher<Action extends object, Result> = ((
  action: Action,
) => Promise<Result>) & {
  /** A newer authoritative room state makes an older uncertain intent a different action. */
  synchronize: (scope: MultiplayerActionScope) => void;
};

function canonicalMultiplayerValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMultiplayerValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalMultiplayerValue(entry)]),
  );
}

export function multiplayerActionFingerprint(action: object) {
  return JSON.stringify(canonicalMultiplayerValue(action));
}

/**
 * Gives one logical action one ID across duplicate taps and uncertain network retries. The room
 * engine remains authoritative and idempotent; this closes the client half of that contract.
 */
export function createReliableMultiplayerActionDispatcher<Action extends object, Result>(
  dispatch: (action: Action, actionId: string) => Promise<Result>,
): ReliableMultiplayerActionDispatcher<Action, Result> {
  const inFlight = new Map<string, Promise<Result>>();
  const uncertain = new Map<string, string>();
  let scope: MultiplayerActionScope;
  let generation = 0;

  const reliable = (action: Action): Promise<Result> => {
    const fingerprint = multiplayerActionFingerprint(action);
    const actionGeneration = generation;
    const inFlightKey = `${actionGeneration}:${fingerprint}`;
    const existing = inFlight.get(inFlightKey);
    if (existing) return existing;

    const actionId = uncertain.get(fingerprint) ?? crypto.randomUUID();
    let request: Promise<Result>;
    request = Promise.resolve()
      .then(() => dispatch(action, actionId))
      .then(
        (result) => {
          uncertain.delete(fingerprint);
          return result;
        },
        (error: unknown) => {
          // If a wake or another mutation already moved the room on, this rejected request belongs
          // to the previous state. Reusing its ID for an identical control in the new state could
          // silently turn a legitimate second action into an old no-op.
          if (generation === actionGeneration) {
            uncertain.delete(fingerprint);
            uncertain.set(fingerprint, actionId);
            while (uncertain.size > MAX_UNCERTAIN_ACTIONS) {
              const oldest = uncertain.keys().next().value;
              if (typeof oldest !== "string") break;
              uncertain.delete(oldest);
            }
          }
          throw error;
        },
      )
      .finally(() => {
        if (inFlight.get(inFlightKey) === request) inFlight.delete(inFlightKey);
      });
    inFlight.set(inFlightKey, request);
    return request;
  };
  reliable.synchronize = (nextScope: MultiplayerActionScope) => {
    if (Object.is(scope, nextScope)) return;
    scope = nextScope;
    generation += 1;
    uncertain.clear();
  };
  return reliable;
}

export function useReliableMultiplayerAction<Action extends object, Result>(
  dispatch: (action: Action, actionId: string) => Promise<Result>,
  scope: MultiplayerActionScope,
) {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const reliableRef = useRef<ReliableMultiplayerActionDispatcher<Action, Result> | null>(null);
  reliableRef.current ??= createReliableMultiplayerActionDispatcher((action, actionId) =>
    dispatchRef.current(action, actionId),
  );
  reliableRef.current.synchronize(scope);
  return reliableRef.current;
}
