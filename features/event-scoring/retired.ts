export function retiredScoringResponse(): Response {
  return Response.json(
    {
      error: "Event points are no longer available.",
      code: "event_scoring_retired",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
