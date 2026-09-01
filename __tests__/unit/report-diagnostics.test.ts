import { describe, expect, it } from "vitest";

import { captureDiagnosticContext } from "@/features/reports/diagnostics";

describe("report diagnostics", () => {
  it("should preserve a bounded safe message for route errors", () => {
    const diagnostics = captureDiagnosticContext({
      error: new TypeError(
        `Could not load https://user:password@example.com/admin?token=private ${"x".repeat(600)}`,
      ),
    });

    expect(diagnostics.error).toMatchObject({
      name: "TypeError",
      message: expect.stringContaining("https://[redacted]@example.com/admin?token=[redacted]"),
    });
    expect(diagnostics.error?.message).toHaveLength(500);
    expect(diagnostics.error?.message).not.toContain("password");
    expect(diagnostics.error?.message).not.toContain("private");
  });

  it("should preserve details from errors deserialized across a route boundary", () => {
    const diagnostics = captureDiagnosticContext({
      error: { name: "TypeError", code: "route_render", message: "Cannot read properties of null" },
    });

    expect(diagnostics.error).toMatchObject({
      name: "TypeError",
      code: "route_render",
      message: "Cannot read properties of null",
    });
  });
});
