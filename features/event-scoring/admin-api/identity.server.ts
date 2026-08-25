import { pseudonymizeEventPerson } from "../identity.server";
import { mergeParticipants, reverseParticipantMerge } from "../scoring.server";
import { stringsValue, stringValue, type AdminScoringActionHandlers } from "./shared";

export const identityActions: AdminScoringActionHandlers = {
  "merge-participants": async ({ eventSlug, actorId, body }) => {
    const sourceParticipantId = stringValue(body.sourceParticipantId);
    const targetParticipantId = stringValue(body.targetParticipantId);
    const reason = stringValue(body.reason);
    const evidence = stringsValue(body.evidence);
    if (!sourceParticipantId || !targetParticipantId || !reason || evidence.length === 0)
      return Response.json(
        { error: "Two participants, evidence, and a reason are required" },
        { status: 400 },
      );
    const result = await mergeParticipants({
      eventSlug,
      sourceParticipantId,
      targetParticipantId,
      actorId,
      reason,
      evidence,
    });
    return result.ok
      ? Response.json({ merged: true })
      : Response.json({ error: result.error }, { status: result.status });
  },

  "split-participants": async ({ actorId, body }) => {
    const mergeId = stringValue(body.mergeId);
    const reason = stringValue(body.reason);
    if (!mergeId || !reason)
      return Response.json({ error: "Merge and reason are required" }, { status: 400 });
    const result = await reverseParticipantMerge({ mergeId, actorId, reason });
    return result.ok
      ? Response.json({ split: true })
      : Response.json({ error: result.error }, { status: result.status });
  },

  "pseudonymize-person": async ({ eventSlug, actorId, body }) => {
    const personId = stringValue(body.personId);
    const reason = stringValue(body.reason);
    if (!personId || !reason)
      return Response.json({ error: "Person and privacy reason are required" }, { status: 400 });
    const result = await pseudonymizeEventPerson({ eventSlug, personId, actorId, reason });
    return result.ok
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: result.status });
  },
};
