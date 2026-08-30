import { describe, expect, it } from "vitest";

import { BASE_URL } from "@/lib/shared/config";
import { buildRobotsTxt } from "@/src/routes/robots[.]txt";

describe("robots.txt", () => {
  it("derives its sitemap from the configured canonical origin", () => {
    expect(buildRobotsTxt()).toBe(
      ["User-agent: *", "Allow: /", "", `Sitemap: ${new URL("/sitemap.xml", BASE_URL)}`, ""].join(
        "\n",
      ),
    );
  });
});
