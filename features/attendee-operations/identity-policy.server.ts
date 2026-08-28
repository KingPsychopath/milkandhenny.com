import { createHash } from "node:crypto";

import { normaliseEmail } from "@/lib/shared/email-address";
import { queryOne } from "@/lib/platform/postgres.server";

function identityEmailHash(email: string): string {
  return createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

/** One eligibility decision for every workflow that grants something new. */
export async function identityMayAcquire(email: string): Promise<boolean> {
  const result = await queryOne<{ acquisition_status: "active" | "restricted" }>(
    `select person.acquisition_status
       from event_person_identifiers identifier
       join event_people person on person.id = identifier.person_id
      where identifier.kind = 'email' and identifier.value_hash = $1`,
    [identityEmailHash(email)],
  );
  return result?.acquisition_status !== "restricted";
}

export async function requireIdentityMayAcquire(email: string, message: string): Promise<void> {
  if (!(await identityMayAcquire(email))) throw new IdentityAcquisitionRestrictedError(message);
}

export class IdentityAcquisitionRestrictedError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "IdentityAcquisitionRestrictedError";
  }
}
