import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { authenticateRequest } from "@/features/auth/auth.server";
import { runPitchesResult } from "./pitches-runtime.server";
import { PitchesService } from "./pitches-service.server";
import { isPitchDeckId } from "./validation";
import {
  PRESENTATION_ACTION_PATTERN,
  PRESENTATION_ROOM_PATTERN,
  PRESENTATION_TOKEN_PATTERN,
} from "./presentation-validation";

type PresentationOperation<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

async function runPresentationOperation<T>(
  effect: Effect.Effect<PresentationOperation<T>, unknown, PitchesService>,
): Promise<PresentationOperation<T>> {
  const result = await runPitchesResult(effect);
  return result.ok ? result.value : { ok: false, status: result.status, error: result.error };
}

export const createPresentationRoomFn = createServerFn({ method: "POST" })
  .validator((data?: { eventTitle?: string }) => data)
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) {
      return { ok: false as const, status: 401, error: "Admin access is required" };
    }
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.createPresentation(data?.eventTitle);
      }),
    );
    return result.ok
      ? { ok: true as const, value: result.value }
      : { ok: false as const, status: result.status, error: result.error };
  });

export const joinPresentationFn = createServerFn({ method: "POST" })
  .validator((data: { roomId: string; name: string }) => data)
  .handler(({ data }) => {
    if (
      !PRESENTATION_ROOM_PATTERN.test(data.roomId) ||
      !data.name.trim() ||
      data.name.length > 80
    ) {
      return Promise.resolve({
        ok: false as const,
        status: 400,
        error: "Check your name and room code",
      });
    }
    return runPresentationOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.joinPresentation(data.roomId, data.name);
      }),
    );
  });

type ReadInput =
  | { roomId: string; hostToken: string; controllerId?: never; controllerToken?: never }
  | { roomId: string; controllerId: string; controllerToken: string; hostToken?: never }
  | { roomId: string; hostToken?: never; controllerId?: never; controllerToken?: never };

export const readPresentationFn = createServerFn({ method: "POST" })
  .validator((data: ReadInput) => data)
  .handler(({ data }) => {
    if (!PRESENTATION_ROOM_PATTERN.test(data.roomId)) {
      return Promise.resolve({ ok: false as const, status: 404, error: "Presentation not found" });
    }
    if (data.hostToken !== undefined) {
      if (!PRESENTATION_TOKEN_PATTERN.test(data.hostToken))
        return Promise.resolve({
          ok: false as const,
          status: 404,
          error: "Presentation not found",
        });
      return runPresentationOperation(
        Effect.gen(function* () {
          const pitches = yield* PitchesService;
          return yield* pitches.readPresentation(data.roomId, {
            hostToken: data.hostToken,
          });
        }),
      );
    }
    if (data.controllerId !== undefined || data.controllerToken !== undefined) {
      if (
        !data.controllerId ||
        !data.controllerToken ||
        !PRESENTATION_TOKEN_PATTERN.test(data.controllerId) ||
        !PRESENTATION_TOKEN_PATTERN.test(data.controllerToken)
      )
        return Promise.resolve({
          ok: false as const,
          status: 404,
          error: "Presentation not found",
        });
      return runPresentationOperation(
        Effect.gen(function* () {
          const pitches = yield* PitchesService;
          return yield* pitches.readPresentation(data.roomId, {
            controllerId: data.controllerId,
            controllerToken: data.controllerToken,
          });
        }),
      );
    }
    return runPresentationOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.readPresentation(data.roomId);
      }),
    );
  });

export const approvePresentationControllerFn = createServerFn({ method: "POST" })
  .validator(
    (data: { roomId: string; hostToken: string; controllerId: string; approved: boolean }) => data,
  )
  .handler(({ data }) => {
    if (
      !PRESENTATION_ROOM_PATTERN.test(data.roomId) ||
      !PRESENTATION_TOKEN_PATTERN.test(data.hostToken) ||
      !PRESENTATION_TOKEN_PATTERN.test(data.controllerId)
    ) {
      return Promise.resolve({
        ok: false as const,
        status: 400,
        error: "Invalid remote request",
      });
    }
    return runPresentationOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.approveController(data);
      }),
    );
  });

type ControlInput = {
  roomId: string;
  credential: string;
  controllerId?: string;
  actionId: string;
  action:
    | { type: "select"; deckId: string }
    | { type: "go"; direction: -1 | 1 }
    | { type: "slide"; index: number };
};

export const controlPresentationFn = createServerFn({ method: "POST" })
  .validator((data: ControlInput) => data)
  .handler(({ data }) => {
    const validAction =
      (data.action.type === "select" && isPitchDeckId(data.action.deckId)) ||
      (data.action.type === "go" &&
        (data.action.direction === -1 || data.action.direction === 1)) ||
      (data.action.type === "slide" &&
        Number.isInteger(data.action.index) &&
        data.action.index >= 0);
    return PRESENTATION_ROOM_PATTERN.test(data.roomId) &&
      PRESENTATION_TOKEN_PATTERN.test(data.credential) &&
      PRESENTATION_ACTION_PATTERN.test(data.actionId) &&
      (!data.controllerId || PRESENTATION_TOKEN_PATTERN.test(data.controllerId)) &&
      validAction
      ? runPresentationOperation(
          Effect.gen(function* () {
            const pitches = yield* PitchesService;
            return yield* pitches.controlPresentation(data);
          }),
        )
      : Promise.resolve({ ok: false as const, status: 400, error: "Invalid presentation action" });
  });
