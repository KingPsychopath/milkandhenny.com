import { afterEach, describe, expect, it } from "vitest";
import { presignPutUrl } from "@/lib/platform/r2.server";

const envKeys = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY",
  "R2_SECRET_KEY",
  "R2_PUBLIC_BUCKET",
  "R2_PRIVATE_BUCKET",
] as const;

describe("R2 bucket routing", () => {
  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it("should route transfer keys only to the private bucket", async () => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY = "test-key";
    process.env.R2_SECRET_KEY = "test-secret";
    process.env.R2_PUBLIC_BUCKET = "public-bucket";
    process.env.R2_PRIVATE_BUCKET = "private-bucket";

    const publicUrl = new URL(await presignPutUrl("albums/album/photo.jpg", "image/jpeg"));
    const privateUrl = new URL(
      await presignPutUrl("transfers/transfer/originals/photo.jpg", "image/jpeg"),
    );
    const privateWordUrl = new URL(
      await presignPutUrl("words/media/private-note/photo.jpg", "image/jpeg", 900, {
        scope: "private",
      }),
    );

    expect(publicUrl.host).toBe("public-bucket.test-account.r2.cloudflarestorage.com");
    expect(privateUrl.host).toBe("private-bucket.test-account.r2.cloudflarestorage.com");
    expect(privateWordUrl.host).toBe("private-bucket.test-account.r2.cloudflarestorage.com");
  });
});
