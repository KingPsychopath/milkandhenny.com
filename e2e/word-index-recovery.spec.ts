import { expect, test } from "@playwright/test";
import { Redis } from "@upstash/redis";
import { withRedisProvider } from "@/lib/platform/redis-provider-context.server";
import {
  withObjectStorageProvider,
  r2ObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import {
  createWord,
  deleteWord,
  getWord,
  inspectWordPersistence,
  listAllWords,
} from "@/features/words/store.server";
import { exportWordArchive, restoreWordArchive } from "@/features/words/archive.server";

test("real Redis index inspection repairs interrupted discovery and blocks incomplete backups", async () => {
  const redis = new Redis({ url: "http://127.0.0.1:56380", token: "local-browser-test" });
  const slug = `index-recovery-${Date.now()}`;
  const dangling = `${slug}-dangling`;
  await withRedisProvider(redis, () =>
    withObjectStorageProvider(
      {
        ...r2ObjectStorageProvider,
        isConfigured: () => false,
      },
      async () => {
        try {
          const original = await createWord({
            slug,
            title: "Index recovery",
            markdown: "Original private body",
          });
          const archive = await exportWordArchive();
          await redis.srem("words:index", slug);
          await redis.sadd("words:index", dangling);
          const before = await inspectWordPersistence();
          expect(before.unindexed).toContain(slug);
          expect(before.dangling).toContain(dangling);
          expect(await getWord(slug)).toEqual(original);
          await expect(exportWordArchive()).rejects.toThrow("inconsistent");
          await expect(restoreWordArchive(archive)).rejects.toThrow("empty target");
          await inspectWordPersistence(true);
          const after = await inspectWordPersistence();
          expect(after.unindexed).not.toContain(slug);
          expect(after.dangling).not.toContain(dangling);
          expect(
            (await listAllWords({ includeNonPublic: true })).some((word) => word.slug === slug),
          ).toBe(true);
          expect(await getWord(slug)).toEqual(original);
          await inspectWordPersistence(true);
          expect(await getWord(slug)).toEqual(original);
        } finally {
          await deleteWord(slug);
          await redis.srem("words:index", dangling);
        }
      },
    ),
  );
});

for (const failurePoint of ["before", "after"] as const) {
  test(`word create/delete recover when the Redis commit response fails ${failurePoint} execution`, async () => {
    const redis = new Redis({ url: "http://127.0.0.1:56380", token: "local-browser-test" });
    const uncertain = new Proxy(redis, {
      get(target, key, receiver) {
        if (key !== "multi") return Reflect.get(target, key, receiver);
        return () => {
          const transaction = target.multi();
          const exec = transaction.exec.bind(transaction);
          transaction.exec = async () => {
            if (failurePoint === "after") await exec();
            throw new Error("Injected commit response failure");
          };
          return transaction;
        };
      },
    });
    const slug = `commit-${failurePoint}-${Date.now()}`;
    await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, isConfigured: () => false },
      async () => {
        try {
          await expect(
            withRedisProvider(uncertain, () =>
              createWord({ slug, title: "Commit recovery", markdown: "Body" }),
            ),
          ).rejects.toThrow("Injected");
          await withRedisProvider(redis, async () => {
            const inspection = await inspectWordPersistence();
            expect(inspection.unindexed).not.toContain(slug);
            expect(inspection.dangling).not.toContain(slug);
            if (failurePoint === "before") {
              expect(await getWord(slug)).toBeNull();
              await createWord({ slug, title: "Commit recovery", markdown: "Body" });
            }
            expect((await getWord(slug))?.markdown).toBe("Body");
          });
          await expect(withRedisProvider(uncertain, () => deleteWord(slug))).rejects.toThrow(
            "Injected",
          );
          await withRedisProvider(redis, async () => {
            const inspection = await inspectWordPersistence();
            expect(inspection.unindexed).not.toContain(slug);
            expect(inspection.dangling).not.toContain(slug);
            if (failurePoint === "before") expect(inspection.missingBodies).toContain(slug);
            expect(await deleteWord(slug)).toBe(failurePoint === "before");
            expect(await getWord(slug)).toBeNull();
          });
        } finally {
          await withRedisProvider(redis, () => deleteWord(slug));
        }
      },
    );
  });
}
