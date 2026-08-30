import { beforeEach, describe, expect, it, vi } from "vitest";

const { optOutByToken } = vi.hoisted(() => ({ optOutByToken: vi.fn() }));

vi.mock("@/features/communications/communications.server", () => ({
  optOutByToken,
}));

import { GET, POST } from "@/src/routes/api/marketing/unsubscribe/$token/route";

describe("marketing unsubscribe route", () => {
  beforeEach(() => {
    optOutByToken.mockReset();
  });

  it("does not change consent when an email scanner follows the GET link", async () => {
    const response = await GET(new Request("https://example.com/unsubscribe"), "token");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toContain("Stop marketing emails?");
    expect(body).toContain('<form method="post">');
    expect(optOutByToken).not.toHaveBeenCalled();
  });

  it("withdraws consent only after a POST", async () => {
    optOutByToken.mockResolvedValue(true);

    const response = await POST(
      new Request("https://example.com/unsubscribe", { method: "POST" }),
      "token",
    );

    expect(await response.text()).toContain("You are unsubscribed");
    expect(optOutByToken).toHaveBeenCalledWith("token");
  });
});
