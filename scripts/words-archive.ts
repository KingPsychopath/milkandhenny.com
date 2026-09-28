import { getRedis } from "@/lib/platform/redis.server";
import { isDatabaseConfigured } from "@/lib/platform/postgres.server";
import { isConfigured } from "@/lib/platform/r2.server";
import { inspectWordPersistence } from "@/features/words/store.server";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  exportWordArchive,
  parseWordArchive,
  restoreWordArchive,
} from "@/features/words/archive.server";

const metadataConfigured =
  process.env.WORD_STORE === "postgres" ? isDatabaseConfigured() : Boolean(getRedis());
if (!metadataConfigured || !isConfigured())
  throw new Error("Word archive operations require configured durable metadata and object storage");

const [action, file, confirmation] = process.argv.slice(2);
if (action !== "inspect" && (!file || !isAbsolute(file)))
  throw new Error("Use an absolute archive path");
if (action === "inspect") {
  console.log(JSON.stringify(await inspectWordPersistence(file === "--repair-index"), null, 2));
} else if (action === "backup") {
  const archive = await exportWordArchive();
  await writeFile(file, archive, { flag: "wx", mode: 0o600 });
  console.log(`Word archive saved: ${parseWordArchive(archive).length} records`);
} else if (action === "restore") {
  if (confirmation !== "--confirm-empty-target")
    throw new Error(
      "Restore requires --confirm-empty-target and isolated empty metadata/object storage",
    );
  console.log(`Words restored: ${await restoreWordArchive(await readFile(file, "utf8"))}`);
} else
  throw new Error(
    "Use backup <absolute-file.json> or restore <absolute-file.json> --confirm-empty-target",
  );
