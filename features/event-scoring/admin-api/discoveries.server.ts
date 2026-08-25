import {
  copyDiscovery,
  createDiscovery,
  replaceDiscoveryClueSecret,
  replaceDiscoverySecret,
  testDiscoveryCredential,
  updateDiscovery,
} from "../discoveries.server";
import { resultResponse, stringValue, type AdminScoringActionHandlers } from "./shared";

export const discoveryActions: AdminScoringActionHandlers = {
  "create-discovery": async ({ eventSlug, body }) => {
    const activityId = stringValue(body.activityId);
    const name = stringValue(body.name);
    const method = stringValue(body.method);
    if (!name || !method || !body.rule || typeof body.rule !== "object" || Array.isArray(body.rule))
      return Response.json(
        { error: "Discovery name, method, and rule are required" },
        { status: 400 },
      );
    return resultResponse(
      await createDiscovery({
        eventSlug,
        activityId: activityId || undefined,
        name,
        method: method as Parameters<typeof createDiscovery>[0]["method"],
        rule: body.rule as Parameters<typeof createDiscovery>[0]["rule"],
        clues: Array.isArray(body.clues)
          ? body.clues.flatMap((clue) => {
              if (!clue || typeof clue !== "object" || Array.isArray(clue)) return [];
              const record = clue as Record<string, unknown>;
              const key = stringValue(record.key);
              const label = stringValue(record.label);
              return key && label ? [{ key, label }] : [];
            })
          : undefined,
        includeSecret: true,
      }),
      "discovery",
      201,
    );
  },

  "replace-discovery-secret": async ({ eventSlug, actorId, body }) => {
    const discoveryId = stringValue(body.discoveryId);
    if (!discoveryId) return Response.json({ error: "Discovery is required" }, { status: 400 });
    const result = await replaceDiscoverySecret({ eventSlug, discoveryId, actorId });
    return result.ok
      ? Response.json(result.value, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: result.error }, { status: result.status });
  },

  "update-discovery": async ({ eventSlug, actorId, body }) => {
    const discoveryId = stringValue(body.discoveryId);
    if (!discoveryId) return Response.json({ error: "Discovery is required" }, { status: 400 });
    return resultResponse(
      await updateDiscovery({
        eventSlug,
        discoveryId,
        actorId,
        name: stringValue(body.name),
        status: stringValue(body.status),
        rule:
          body.rule && typeof body.rule === "object" && !Array.isArray(body.rule)
            ? (body.rule as Parameters<typeof updateDiscovery>[0]["rule"])
            : undefined,
        reopen: body.reopen === true,
        reason: stringValue(body.reason),
      }),
      "discovery",
    );
  },

  "copy-discovery": async ({ eventSlug, actorId, body }) => {
    const discoveryId = stringValue(body.discoveryId);
    if (!discoveryId) return Response.json({ error: "Discovery is required" }, { status: 400 });
    return resultResponse(
      await copyDiscovery({
        eventSlug,
        discoveryId,
        actorId,
        name: stringValue(body.name),
      }),
      "discovery",
      201,
    );
  },

  "replace-discovery-clue": async ({ eventSlug, actorId, body }) => {
    const discoveryId = stringValue(body.discoveryId);
    const clueKey = stringValue(body.clueKey);
    if (!discoveryId || !clueKey)
      return Response.json({ error: "Discovery and clue are required" }, { status: 400 });
    const result = await replaceDiscoveryClueSecret({ eventSlug, discoveryId, clueKey, actorId });
    return result.ok
      ? Response.json(result.value, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: result.error }, { status: result.status });
  },

  "test-discovery": async ({ body }) => {
    const discoveryId = stringValue(body.discoveryId);
    const presented = stringValue(body.presented);
    if (!discoveryId || !presented)
      return Response.json({ error: "Discovery and credential are required" }, { status: 400 });
    return resultResponse(await testDiscoveryCredential({ discoveryId, presented }), "test");
  },
};
