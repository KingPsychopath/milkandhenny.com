import { describe, expect, it } from "vitest";
import { localDevEnvironment } from "../../scripts/local-dev-env.mjs";

describe("local development isolation", () => {
  it("keeps operating-system settings and excludes inherited remote providers", () => {
    const env = localDevEnvironment(
      {
        PATH: "/tools",
        HOME: "/user",
        DATABASE_URL: "postgres://remote",
        R2_PUBLIC_SECRET_KEY: "remote",
        STRIPE_SECRET_KEY: "remote",
        EMAIL_API_TOKEN: "remote",
        UPSTASH_REDIS_REST_URL: "https://remote",
      },
      "local-secret",
      3100,
    );
    expect(env.PATH).toBe("/tools");
    expect(env.HOME).toBe("/user");
    expect(env.DATABASE_URL).toContain("127.0.0.1:55433");
    expect(env.R2_PUBLIC_SECRET_KEY).toBe("local-development-secret");
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.EMAIL_API_TOKEN).toBeUndefined();
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(env.VITE_BASE_URL).toBe("http://127.0.0.1:3100");
    expect(env.MULTIPLAYER_REALTIME_BACKPLANE).toBe("postgres");
    expect(env.MAH_LOCAL_DEV).toBe("1");
  });
});
