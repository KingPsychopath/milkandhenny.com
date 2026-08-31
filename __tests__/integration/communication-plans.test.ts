import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  listCommunicationPlans,
  listCommunicationStageDeliveries,
} from "@/features/communications/communication-plans.server";
import { hashEmail as hashTicketEmail } from "@/features/tickets/qr.server";
import { hashEmailRecipient } from "@/lib/platform/email-outbox.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("communication plans (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(truncateAll);

  it("should supersede a failed historical address after its replacement is delivered", async () => {
    const eventSlug = "corrected-recipient-event";
    const planId = randomUUID();
    const stageId = randomUUID();
    const oldEmail = "person@gmail.con";
    const currentEmail = "person@gmail.com";
    const oldHash = hashEmailRecipient(oldEmail);
    const currentHash = hashEmailRecipient(currentEmail);
    const currentTicketHash = hashTicketEmail(currentEmail);

    await query(
      `insert into events (slug,title,status,starts_at,timezone)
       values ($1,'Corrected recipient','published',now() + interval '1 day','Europe/London')`,
      [eventSlug],
    );
    await query(
      `insert into ticket_types (event_slug,id,name,quantity) values ($1,'general','General',10)`,
      [eventSlug],
    );
    await query(
      `insert into tickets
         (id,event_slug,ticket_type_id,holder_name,email,email_hash,order_id)
       values ('TICKET-CORRECT-01',$1,'general','Person',$2,$3,'order-corrected')`,
      [eventSlug, currentEmail, currentTicketHash],
    );
    await query(
      `insert into communication_contacts
         (email_hash,email,display_name,sources,unsubscribe_token)
       values ($1,$2,'Person','{event}',$3),($4,$5,'Person','{event}',$6)`,
      [oldHash, oldEmail, randomUUID(), currentHash, currentEmail, randomUUID()],
    );
    await query(
      `insert into communication_plans (id,event_slug,name,status)
       values ($1,$2,'Corrected recipient plan','scheduled')`,
      [planId, eventSlug],
    );
    await query(
      `insert into communication_plan_stages
         (id,plan_id,stage_key,label,position,kind,audience,subject,body,status,
          recipient_count,queued_count)
       values ($1,$2,'prepare','Preparation',0,'event_service','event_attendees',
               'Preparation','The message','queued',2,1)`,
      [stageId, planId],
    );
    await query(
      `insert into communication_stage_deliveries (stage_id,email_hash,email,status)
       values ($1,$2,$3,'failed')`,
      [stageId, oldHash, oldEmail],
    );

    const [beforeReplacement] = await listCommunicationPlans(eventSlug);
    expect(beforeReplacement?.stages[0]).toMatchObject({
      audienceCount: 1,
      receivedCount: 0,
      missingRecipientCount: 1,
      delivery: { failed: 0, delivered: 0 },
    });

    await query(
      `insert into communication_stage_deliveries (stage_id,email_hash,email,status)
       values ($1,$2,$3,'delivered')`,
      [stageId, currentHash, currentEmail],
    );

    const [afterReplacement] = await listCommunicationPlans(eventSlug);
    expect(afterReplacement?.stages[0]).toMatchObject({
      recipientCount: 2,
      audienceCount: 1,
      receivedCount: 1,
      missingRecipientCount: 0,
      deliveryState: "delivered",
      delivery: {
        queued: 0,
        accepted: 0,
        delivered: 1,
        deferred: 0,
        failed: 0,
        bounced: 0,
        rejected: 0,
        complained: 0,
        skipped: 0,
      },
    });

    await expect(listCommunicationStageDeliveries(stageId)).resolves.toMatchObject([
      {
        email: currentEmail,
        isCurrentRecipient: true,
        deliveryStatus: "delivered",
      },
      {
        email: oldEmail,
        isCurrentRecipient: false,
        deliveryStatus: "failed",
      },
    ]);
  });

  it("should keep a failed current recipient actionable", async () => {
    const eventSlug = "failed-current-recipient";
    const planId = randomUUID();
    const stageId = randomUUID();
    const email = "current@example.com";
    const emailHash = hashEmailRecipient(email);
    const ticketEmailHash = hashTicketEmail(email);

    await query(
      `insert into events (slug,title,status,starts_at,timezone)
       values ($1,'Current failure','published',now() + interval '1 day','Europe/London')`,
      [eventSlug],
    );
    await query(
      `insert into ticket_types (event_slug,id,name,quantity) values ($1,'general','General',10)`,
      [eventSlug],
    );
    await query(
      `insert into tickets
         (id,event_slug,ticket_type_id,holder_name,email,email_hash,order_id)
       values ('TICKET-CURRENT-001',$1,'general','Current',$2,$3,'order-current')`,
      [eventSlug, email, ticketEmailHash],
    );
    await query(
      `insert into communication_contacts
         (email_hash,email,display_name,sources,unsubscribe_token)
       values ($1,$2,'Current','{event}',$3)`,
      [emailHash, email, randomUUID()],
    );
    await query(
      `insert into communication_plans (id,event_slug,name,status)
       values ($1,$2,'Current failure plan','scheduled')`,
      [planId, eventSlug],
    );
    await query(
      `insert into communication_plan_stages
         (id,plan_id,stage_key,label,position,kind,audience,subject,body,status,
          recipient_count)
       values ($1,$2,'prepare','Preparation',0,'event_service','event_attendees',
               'Preparation','The message','queued',1)`,
      [stageId, planId],
    );
    await query(
      `insert into communication_stage_deliveries (stage_id,email_hash,email,status)
       values ($1,$2,$3,'failed')`,
      [stageId, emailHash, email],
    );

    const [plan] = await listCommunicationPlans(eventSlug);
    expect(plan?.stages[0]).toMatchObject({
      audienceCount: 1,
      receivedCount: 0,
      missingRecipientCount: 0,
      deliveryState: "complete with issues",
      delivery: { failed: 1, delivered: 0 },
    });

    await expect(listCommunicationStageDeliveries(stageId)).resolves.toMatchObject([
      {
        email,
        isCurrentRecipient: true,
        deliveryStatus: "failed",
      },
    ]);
  });
});
