import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

process.env.AUTH_SECRET = "attendee-access-test-secret-32-characters";

import {
  __attendeeAccessTesting,
  attendeeAccount,
  claimTicketForPerson,
  managedOrderIdsForPerson,
  releaseOwnTicketClaim,
  verifyAttendeeAccess,
} from "@/features/attendee-access/access.server";
import { removePersonEmail } from "@/features/attendee-operations/identity-manager.server";
import { participantForTicket } from "@/features/event-scoring/store.server";
import { pseudonymizeEventPerson } from "@/features/event-scoring/identity.server";
import { hashEmail } from "@/features/tickets/qr.server";
import { query } from "@/lib/platform/postgres.server";
import { runMigrations } from "@/lib/platform/migrations.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const EVENT = "identity-night";
const PRIMARY = "01ARZ3NDEKTSV4RA";
const CHILD = "01ARZ3NDEKTSV4RB";
const SPARE = "01ARZ3NDEKTSV4RC";
const BUYER_EMAIL = "buyer@example.com";
const GUEST_EMAIL = "guest@example.com";
const SECRET = process.env.AUTH_SECRET!;

async function seedSoldOrder() {
  const buyerHash = hashEmail(BUYER_EMAIL);
  await query(
    `insert into events (slug,title,status,starts_at,timezone)
     values ($1,'Identity Night','published',now() + interval '7 days','Europe/London')`,
    [EVENT],
  );
  await query(
    `insert into ticket_types (event_slug,id,name,quantity)
     values ($1,'entry','Entry',20)`,
    [EVENT],
  );
  await query(
    `insert into tickets
       (id,event_slug,ticket_type_id,holder_name,email,email_hash,order_id,parent_ticket_id)
     values
       ($1,$4,'entry','Buyer',$5,$6,'ord_identitytest1',null),
       ($2,$4,'entry','Guest',$5,$6,'ord_identitytest1',$1),
       ($3,$4,'entry','Spare',null,null,'ord_identitytest2',null)`,
    [PRIMARY, CHILD, SPARE, EVENT, BUYER_EMAIL, buyerHash],
  );
}

async function insertChallenge(input: {
  id: string;
  email: string;
  token: string;
  code?: string;
  expires?: string;
  personHint?: string;
}) {
  await query(
    `insert into event_person_login_challenges
       (id,email,email_hash,token_hash,code_hash,purpose,person_id_hint,return_to,expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,'/my',coalesce($8::timestamptz,now() + interval '15 minutes'))`,
    [
      input.id,
      input.email,
      __attendeeAccessTesting.sha256(input.email.toLowerCase()),
      __attendeeAccessTesting.sha256(input.token),
      __attendeeAccessTesting.codeHash(input.code ?? "ABCD2345", SECRET),
      input.personHint ? "add-email" : "sign-in",
      input.personHint ?? null,
      input.expires ?? null,
    ],
  );
}

async function verify(id: string, token: string, sessionId: string) {
  return verifyAttendeeAccess({
    challengeId: id,
    token,
    sessionId,
    ipFingerprint: `ip-${sessionId}`,
  });
}

async function createVerifiedPerson(canonicalName: string, email: string) {
  const emailHash = __attendeeAccessTesting.sha256(email);
  const people = await query<{ id: string }>(
    `insert into event_people (canonical_name) values ($1) returning id::text`,
    [canonicalName],
  );
  const personId = people[0]!.id;
  const identifiers = await query<{ id: string }>(
    `insert into event_person_identifiers
       (person_id,kind,value_hash,verified_at,display_hint,email_address)
     values ($1,'email',$2,now(),$3,$4) returning id::text`,
    [personId, emailHash, `${email[0]}•••@example.com`, email],
  );
  return { personId, identifierId: identifiers[0]!.id, emailHash };
}

describeWithDatabase("attendee person access", () => {
  beforeAll(async () => {
    await applySchema();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedSoldOrder();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("adds the identity schema without changing an already sold ticket", async () => {
    await runMigrations();
    const tickets = await query<{ id: string; holder_name: string }>(
      `select id, holder_name from tickets order by id`,
    );
    expect(tickets).toEqual([
      { id: PRIMARY, holder_name: "Buyer" },
      { id: CHILD, holder_name: "Guest" },
      { id: SPARE, holder_name: "Spare" },
    ]);
    expect(await participantForTicket(PRIMARY)).not.toBeNull();
    expect(await participantForTicket(CHILD)).not.toBeNull();
  });

  it("verifies once, recovers purchaser order management, and claims no child automatically", async () => {
    await insertChallenge({ id: "access_buyer", email: BUYER_EMAIL, token: "buyer-token" });
    const first = await verify("access_buyer", "buyer-token", "session-a");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(await managedOrderIdsForPerson(first.value.personId)).toEqual(["ord_identitytest1"]);
    expect((await participantForTicket(PRIMARY))?.personId).toBeUndefined();
    expect((await participantForTicket(CHILD))?.personId).toBeUndefined();

    const retryOnSameSession = await verify("access_buyer", "buyer-token", "session-a");
    expect(retryOnSameSession).toEqual(first);
    const replayElsewhere = await verify("access_buyer", "buyer-token", "session-b");
    expect(replayElsewhere).toMatchObject({ ok: false, status: 409 });
  });

  it("removes a sign-in email without losing ownership and allows deliberate relinking", async () => {
    await insertChallenge({ id: "access_remove_owner", email: BUYER_EMAIL, token: "owner-token" });
    const signedIn = await verify("access_remove_owner", "owner-token", "owner-session");
    expect(signedIn.ok).toBe(true);
    if (!signedIn.ok) return;
    const account = await attendeeAccount(signedIn.value.personId);
    const buyerIdentity = account?.emails[0];
    expect(buyerIdentity).toBeDefined();
    const backup = await query<{ id: string }>(
      `insert into event_person_identifiers
         (person_id,kind,value_hash,verified_at,display_hint,email_address)
       values ($1,'email',$2,now(),'b•••@example.com','backup@example.com')
       returning id::text`,
      [signedIn.value.personId, __attendeeAccessTesting.sha256("backup@example.com")],
    );

    expect(
      await removePersonEmail({
        personId: signedIn.value.personId,
        identifierId: buyerIdentity!.id,
        actorId: signedIn.value.personId,
        actorType: "attendee",
        reason: "self-service email removal",
      }),
    ).toMatchObject({ ok: true, value: { removed: true } });
    expect(await managedOrderIdsForPerson(signedIn.value.personId)).toEqual(["ord_identitytest1"]);
    expect((await attendeeAccount(signedIn.value.personId))?.emails).toEqual([
      expect.objectContaining({ id: backup[0]!.id }),
    ]);

    await insertChallenge({ id: "access_removed", email: BUYER_EMAIL, token: "removed-token" });
    expect(await verify("access_removed", "removed-token", "removed-session")).toMatchObject({
      ok: false,
      status: 403,
    });

    await insertChallenge({
      id: "access_relink",
      email: BUYER_EMAIL,
      token: "relink-token",
      personHint: signedIn.value.personId,
    });
    expect(await verify("access_relink", "relink-token", "relink-session")).toMatchObject({
      ok: true,
      value: { personId: signedIn.value.personId },
    });
    expect((await attendeeAccount(signedIn.value.personId))?.emails).toHaveLength(2);
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from attendee_operations_audit_events
            where action = 'identity.email.removed' and entity_id = $1`,
          [signedIn.value.personId],
        )
      )[0]?.count,
    ).toBe("1");
  });

  it("does not remove the only verified sign-in email", async () => {
    const person = await createVerifiedPerson("person_single_email", "single@example.com");
    expect(
      await removePersonEmail({
        personId: person.personId,
        identifierId: person.identifierId,
        actorId: person.personId,
        actorType: "attendee",
        reason: "self-service email removal",
      }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("lets a shared-ticket recipient claim only that participant and rejects a racing owner", async () => {
    await insertChallenge({ id: "access_guest", email: GUEST_EMAIL, token: "guest-token" });
    const verified = await verify("access_guest", "guest-token", "guest-session");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(await managedOrderIdsForPerson(verified.value.personId)).toEqual([]);

    const participant = await participantForTicket(CHILD);
    expect(participant).not.toBeNull();
    const rival = await createVerifiedPerson("person_rival", "rival@example.com");
    const [guestClaim, rivalClaim] = await Promise.all([
      claimTicketForPerson({
        personId: verified.value.personId,
        verifiedEmailHash: verified.value.emailHash,
        ticketId: CHILD,
        permittedParticipantId: participant!.id,
      }),
      claimTicketForPerson({
        personId: rival.personId,
        verifiedEmailHash: rival.emailHash,
        ticketId: CHILD,
        permittedParticipantId: participant!.id,
      }),
    ]);
    expect([guestClaim.ok, rivalClaim.ok].filter(Boolean)).toHaveLength(1);
    expect([guestClaim, rivalClaim].find((result) => !result.ok)).toMatchObject({
      ok: false,
      status: 409,
    });

    const owner = (await participantForTicket(CHILD))?.personId;
    expect(owner).toBe(guestClaim.ok ? verified.value.personId : rival.personId);
    expect((await participantForTicket(PRIMARY))?.personId).toBeUndefined();
    expect((await attendeeAccount(owner!))?.tickets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: CHILD, personallyClaimed: true, points: 0 }),
      ]),
    );
    if (guestClaim.ok) {
      await claimTicketForPerson({
        personId: verified.value.personId,
        verifiedEmailHash: verified.value.emailHash,
        ticketId: CHILD,
        permittedParticipantId: participant!.id,
      });
      expect(
        (
          await query<{ count: string }>(
            `select count(*)::text as count from score_audit_events
              where action = 'identity.ticket.claimed' and entity_id = $1`,
            [participant!.id],
          )
        )[0]?.count,
      ).toBe("1");
    }
  });

  it("allows a mistaken unused claim to be released but protects event history", async () => {
    const person = await createVerifiedPerson("person_owner", "owner@example.com");
    const participant = await participantForTicket(SPARE);
    const claimed = await claimTicketForPerson({
      personId: person.personId,
      verifiedEmailHash: person.emailHash,
      ticketId: SPARE,
      permittedParticipantId: participant!.id,
    });
    expect(claimed.ok).toBe(true);
    expect(await releaseOwnTicketClaim({ personId: person.personId, ticketId: SPARE })).toEqual({
      ok: true,
      value: { released: true },
    });
    expect((await participantForTicket(SPARE))?.personId).toBeUndefined();

    await claimTicketForPerson({
      personId: person.personId,
      verifiedEmailHash: person.emailHash,
      ticketId: SPARE,
      permittedParticipantId: participant!.id,
    });
    await query(`update tickets set redeemed_at = now() where id = $1`, [SPARE]);
    expect(
      await releaseOwnTicketClaim({ personId: person.personId, ticketId: SPARE }),
    ).toMatchObject({ ok: false, status: 409 });
    expect((await participantForTicket(SPARE))?.personId).toBe(person.personId);
  });

  it("preserves claim audit rows while privacy removal deletes verified identifiers", async () => {
    const person = await createVerifiedPerson("person_private", "private@example.com");
    const participant = await participantForTicket(SPARE);
    expect(
      await claimTicketForPerson({
        personId: person.personId,
        verifiedEmailHash: person.emailHash,
        ticketId: SPARE,
        permittedParticipantId: participant!.id,
      }),
    ).toMatchObject({ ok: true });

    expect(
      await pseudonymizeEventPerson({
        eventSlug: EVENT,
        personId: person.personId,
        actorId: "admin_test",
        reason: "privacy request",
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from event_person_identifiers where person_id = $1`,
          [person.personId],
        )
      )[0]?.count,
    ).toBe("0");
    expect(
      (
        await query<{ identifier_id: string | null }>(
          `select identifier_id from event_ticket_identity_claims where ticket_id = $1`,
          [SPARE],
        )
      )[0]?.identifier_id,
    ).toBeNull();
  });

  it("expires credentials and limits repeated wrong codes without creating a person", async () => {
    await insertChallenge({
      id: "access_expired",
      email: "expired@example.com",
      token: "expired-token",
      expires: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(await verify("access_expired", "expired-token", "expired-session")).toMatchObject({
      ok: false,
      status: 410,
    });

    await insertChallenge({ id: "access_code", email: "code@example.com", token: "code-token" });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await verifyAttendeeAccess({
        email: "code@example.com",
        code: "WRONG234",
        sessionId: "code-session",
        ipFingerprint: `wrong-code-${attempt}`,
      });
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
    expect(
      await verifyAttendeeAccess({
        email: "code@example.com",
        code: "ABCD2345",
        sessionId: "code-session",
        ipFingerprint: "correct-after-limit",
      }),
    ).toMatchObject({ ok: false, status: 429 });
    expect(
      (await query<{ count: string }>(`select count(*)::text as count from event_people`))[0],
    ).toMatchObject({ count: "0" });
  });
});
