import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

import {
  createWord,
  deleteWord,
  getWord,
  getWordMeta,
  inspectWordPersistence,
  updateWord,
} from "@/features/words/store.server";
import { exportWordArchive, restoreWordArchive } from "@/features/words/archive.server";

// Exercise the production S3 adapter over HTTP. A permanent 403 models an exhausted
// provider failure without introducing retry sleeps or access to a real bucket.
const objects = new Map<string, Buffer>();
let failure: ((method: string, path: string) => boolean) | undefined;
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = decodeURIComponent(url.pathname);
  if (failure?.(request.method ?? "", path)) {
    response.writeHead(403, { "Content-Type": "application/xml" });
    response.end(
      "<Error><Code>AccessDenied</Code><Message>Injected storage failure</Message></Error>",
    );
    return;
  }
  if (request.method === "PUT") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    objects.set(path, Buffer.concat(chunks));
    response.writeHead(200, { ETag: '"test"' });
    response.end();
  } else if (request.method === "DELETE") {
    objects.delete(path);
    response.writeHead(204);
    response.end();
  } else if (request.method === "GET" && url.searchParams.has("list-type")) {
    const prefix = `${path}/${url.searchParams.get("prefix") ?? ""}`;
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
    response.setHeader("Content-Type", "application/xml");
    response.end(
      `<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((key) => `<Contents><Key>${key.slice(path.length + 1)}</Key><Size>${objects.get(key)!.length}</Size></Contents>`).join("")}</ListBucketResult>`,
    );
  } else if (request.method === "GET" && objects.has(path)) {
    const body = objects.get(path)!;
    response.writeHead(200, { "Content-Type": "text/markdown", "Content-Length": body.length });
    response.end(body);
  } else {
    response.writeHead(404, { "Content-Type": "application/xml" });
    response.end("<Error><Code>NoSuchKey</Code></Error>");
  }
});

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  for (const [key, value] of Object.entries({
    S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    R2_ACCOUNT_ID: "local",
    R2_PUBLIC_ACCESS_KEY: "local",
    R2_PUBLIC_SECRET_KEY: "local",
    R2_PRIVATE_ACCESS_KEY: "local",
    R2_PRIVATE_SECRET_KEY: "local",
    R2_PUBLIC_BUCKET: "public",
    R2_PRIVATE_BUCKET: "private",
  }))
    vi.stubEnv(key, value);
});
afterAll(async () => {
  failure = undefined;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("word recovery across object-storage failures", () => {
  it("does not advertise a word when the initial body upload fails; retry succeeds", async () => {
    const input = { slug: "failed-create", title: "Create recovery", markdown: "Private body" };
    failure = (method) => method === "PUT";
    await expect(createWord(input)).rejects.toThrow();
    expect(await getWordMeta(input.slug)).toBeNull();
    failure = undefined;
    const created = await createWord(input);
    expect(await getWord(input.slug)).toEqual(created);
    await deleteWord(input.slug);
  });

  it("keeps the original readable when body promotion fails and permits retry", async () => {
    const original = await createWord({
      slug: "failed-promotion",
      title: "Promotion",
      markdown: "Original",
      visibility: "public",
    });
    failure = (method) => method === "PUT";
    await expect(updateWord(original.meta.slug, { type: "blog" })).rejects.toThrow();
    expect(await getWord(original.meta.slug)).toEqual(original);
    failure = undefined;
    const updated = await updateWord(original.meta.slug, { type: "blog" });
    expect(updated?.meta.type).toBe("blog");
    expect(await getWord(original.meta.slug)).toEqual(updated);
    expect(objects.has(`/public/${original.meta.bodyKey}`)).toBe(false);
    await deleteWord(original.meta.slug);
  });

  it("detects interrupted cleanup and reconstructs the original from a verified archive", async () => {
    const original = await createWord({
      slug: "interrupted-cleanup",
      title: "Recovery",
      markdown: "Retained original",
      visibility: "public",
    });
    const archive = await exportWordArchive();
    // The old body has already been removed when cleanup of the opposite scope fails.
    failure = (method, path) => method === "DELETE" && path.startsWith("/private/words/blog/");
    await expect(updateWord(original.meta.slug, { type: "blog" })).rejects.toThrow();
    failure = undefined;
    expect((await inspectWordPersistence()).missingBodies).toEqual([original.meta.slug]);
    await expect(exportWordArchive()).rejects.toThrow("inconsistent");
    await deleteWord(original.meta.slug);
    objects.clear(); // New isolated object target, as required by the restore runbook.
    expect(await restoreWordArchive(archive)).toBe(1);
    expect(await getWord(original.meta.slug)).toEqual(original);
    expect((await inspectWordPersistence()).missingBodies).toEqual([]);
    await deleteWord(original.meta.slug);
  });

  it("retains metadata after failed deletion so a retry can finish cleanup", async () => {
    const original = await createWord({
      slug: "failed-delete",
      title: "Deletion",
      markdown: "Body",
      visibility: "public",
    });
    failure = (method) => method === "DELETE";
    await expect(deleteWord(original.meta.slug)).rejects.toThrow();
    expect(await getWordMeta(original.meta.slug)).toEqual(original.meta);
    failure = undefined;
    expect(await deleteWord(original.meta.slug)).toBe(true);
    expect(await getWord(original.meta.slug)).toBeNull();
    expect(await deleteWord(original.meta.slug)).toBe(false);
  });
});
