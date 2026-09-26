import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/src/query-client";

describe("router query scope", () => {
  it("creates a distinct cache for each server request", () => {
    const firstQueries = createAppQueryClient();
    const secondQueries = createAppQueryClient();

    expect(firstQueries).not.toBe(secondQueries);
    firstQueries.setQueryData(["attendee", "current", "account"], { id: "viewer-a" });
    secondQueries.setQueryData(["attendee", "current", "account"], { id: "viewer-b" });
    expect(firstQueries.getQueryData(["attendee", "current", "account"])).toEqual({
      id: "viewer-a",
    });
    expect(secondQueries.getQueryData(["attendee", "current", "account"])).toEqual({
      id: "viewer-b",
    });
  });
});
