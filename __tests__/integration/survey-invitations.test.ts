import { raceLockedWrite } from "../helpers/locked-write";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  prepareCommunicationLinkMap,
  recordCommunicationLinkClick,
} from "@/features/communications/email-links.server";
import { communicationLinkKey } from "@/features/communications/email.server";
import {
  getSurveyExperience,
  listSurveyInvitations,
  listSurveyResponses,
  submitSurvey,
} from "@/features/surveys/surveys.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const origin = "https://milkandhenny.com";
const email = "person@example.com";
const recipientHash = createHash("sha256").update(email).digest("hex");

describeWithDatabase("survey invitation lifecycle (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("AUTH_SECRET", "survey-invitation-test-secret");
    await query(
      `insert into communication_contacts
         (email_hash, email, display_name, unsubscribe_token)
       values ($1,$2,'Pat Person',$3)
       on conflict (email_hash) do update
         set email = excluded.email, display_name = excluded.display_name`,
      [recipientHash, email, randomUUID()],
    );
  });

  async function createSurvey(identityMode: "identified" | "optional") {
    const id = randomUUID();
    const slug = `survey-${identityMode}`;
    await query(
      `insert into surveys (id, slug, title, questions, identity_mode, status)
       values ($1,$2,'A question','[{"id":"feeling","type":"long_text","label":"How was it?","required":true}]'::jsonb,$3,'open')`,
      [id, slug, identityMode],
    );
    return { id, slug };
  }

  async function personalToken(slug: string): Promise<string> {
    const destination = `${origin}/surveys/${slug}`;
    const links = await prepareCommunicationLinkMap({
      body: `[Answer the survey](${destination})`,
      context: {},
      origin,
      media: [],
      source: {
        sourceType: "message",
        sourceId: randomUUID(),
        recipientHash,
      },
    });
    const redirect = links.get(communicationLinkKey(destination) ?? "");
    const clickToken = redirect ? new URL(redirect).searchParams.get("token") : null;
    const resolved = await recordCommunicationLinkClick(clickToken ?? "");
    return resolved ? (new URL(resolved).searchParams.get("invite") ?? "") : "";
  }

  it("rejects an answer if the survey closes while submission waits for its lock", async () => {
    const survey = await createSurvey("optional");
    const result = await raceLockedWrite(
      "select id from surveys where id=$1 for update",
      [survey.id],
      () => submitSurvey({ slug: survey.slug, answers: { feeling: "Great" } }),
      "update surveys set status='closed' where id=$1",
    );
    expect(result.status).toBe("rejected");
    expect(await listSurveyResponses(survey.id)).toHaveLength(0);
  });

  it("prefills and links an identified response, then prevents reuse", async () => {
    const survey = await createSurvey("identified");
    const invite = await personalToken(survey.slug);
    const experience = await getSurveyExperience(survey.slug, invite);
    expect(experience?.invitation).toMatchObject({
      respondentEmail: email,
      respondentName: "Pat Person",
      identityMode: "identified",
      completed: false,
    });

    await expect(
      submitSurvey({
        slug: survey.slug,
        invitationToken: invite,
        answers: { feeling: "Wonderful" },
      }),
    ).resolves.toEqual({ accepted: true, alreadySubmitted: false });
    await expect(
      submitSurvey({
        slug: survey.slug,
        invitationToken: invite,
        answers: { feeling: "Again" },
      }),
    ).resolves.toEqual({ accepted: true, alreadySubmitted: true });

    const responses = await listSurveyResponses(survey.id);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      respondentEmail: email,
      respondentName: "Pat Person",
      identitySource: "invitation",
    });
  });

  it("records an optional anonymous completion without linking answers", async () => {
    const survey = await createSurvey("optional");
    const invite = await personalToken(survey.slug);
    await submitSurvey({
      slug: survey.slug,
      invitationToken: invite,
      submitAnonymously: true,
      answers: { feeling: "Keep the conversations" },
    });

    expect(await listSurveyResponses(survey.id)).toEqual([
      expect.objectContaining({
        respondentEmail: null,
        respondentName: null,
        identitySource: "anonymous",
      }),
    ]);
    expect(await listSurveyInvitations(survey.id)).toEqual([
      expect.objectContaining({
        respondentEmail: email,
        completionMode: "anonymous",
      }),
    ]);
  });

  it("keeps old optional generic links usable and rejects generic identified access", async () => {
    const optional = await createSurvey("optional");
    await expect(
      submitSurvey({ slug: optional.slug, answers: { feeling: "Useful" } }),
    ).resolves.toEqual({ accepted: true, alreadySubmitted: false });

    const identified = await createSurvey("identified");
    await expect(
      submitSurvey({ slug: identified.slug, answers: { feeling: "No invite" } }),
    ).rejects.toThrow("personal survey link");
  });
});
