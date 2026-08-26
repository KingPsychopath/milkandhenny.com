import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import { getAttendeeSession } from "@/features/event-scoring/session.server";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  renamePersonPasskey,
  revokePersonPasskey,
} from "./passkeys.server";

export const beginPasskeyAuthenticationFn = createServerFn({ method: "POST" })
  .validator((data: { returnTo?: string }) => data)
  .handler(({ data }) => beginPasskeyAuthentication(getRequest(), data.returnTo));

export const finishPasskeyAuthenticationFn = createServerFn({ method: "POST" })
  .validator((data: { ceremonyId: string; response: AuthenticationResponseJSON }) => data)
  .handler(({ data }) => finishPasskeyAuthentication(data));

export const beginPasskeyRegistrationFn = createServerFn({ method: "POST" }).handler(() =>
  beginPasskeyRegistration(getRequest()),
);

export const finishPasskeyRegistrationFn = createServerFn({ method: "POST" })
  .validator(
    (data: { ceremonyId: string; response: RegistrationResponseJSON; label: string }) => data,
  )
  .handler(({ data }) => finishPasskeyRegistration(data));

export const renamePasskeyFn = createServerFn({ method: "POST" })
  .validator((data: { passkeyId: string; label: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAttendeeSession();
    return session?.personId
      ? renamePersonPasskey({
          personId: session.personId,
          passkeyId: data.passkeyId,
          label: data.label,
        })
      : { ok: false as const, status: 401, error: "Sign in first" };
  });

export const revokePasskeyFn = createServerFn({ method: "POST" })
  .validator((data: { passkeyId: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAttendeeSession();
    return session?.personId
      ? revokePersonPasskey({ personId: session.personId, passkeyId: data.passkeyId })
      : { ok: false as const, status: 401, error: "Sign in first" };
  });
