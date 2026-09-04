import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";
import { query } from "@/lib/platform/postgres.server";
import { readCommunicationsWorkspace } from "@/features/communications/admin-workspace.server";

describeWithDatabase("bounded admin communication reads", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(truncateAll);
  it("paginates contacts without exposing tokens and searches beyond the first page", async () => {
    await query(
      `insert into communication_contacts(email_hash,email,unsubscribe_token) select lpad(i::text,64,'0'), 'person' || i || '@example.com',gen_random_uuid() from generate_series(1,205) i`,
    );
    const first = await readCommunicationsWorkspace({ tab: "people" });
    expect(first.contacts).toHaveLength(100);
    expect(first.contactTotal).toBe(205);
    expect(first.contacts[0]).not.toHaveProperty("unsubscribeToken");
    const second = await readCommunicationsWorkspace({
      tab: "people",
      cursor: first.contactsNextCursor!,
    });
    expect(second.contacts).toHaveLength(100);
    expect(new Set([...first.contacts, ...second.contacts].map((c) => c.emailHash)).size).toBe(200);
    const searched = await readCommunicationsWorkspace({ tab: "people", query: "person205@" });
    expect(searched.contacts.map((c) => c.email)).toEqual(["person205@example.com"]);
    const plan = await readCommunicationsWorkspace({ tab: "event-plan" });
    expect(plan.contacts).toEqual([]);
    expect(plan.messages).toEqual([]);
  });
});
