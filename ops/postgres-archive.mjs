import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { spawn } from "node:child_process";

const [action, fileArgument, confirmation] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (action !== "backup" && action !== "restore") {
  throw new Error(
    "Use: backup <absolute-file.dump> or restore <absolute-file.dump> --confirm-empty-target",
  );
}
if (!fileArgument || !isAbsolute(fileArgument)) {
  throw new Error("The archive path must be absolute");
}

const archivePath = resolve(fileArgument);

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`${command} failed with ${signal ? `signal ${signal}` : `status ${code}`}`),
        );
    });
  });
}

async function sha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

if (action === "backup") {
  try {
    await access(archivePath);
    throw new Error(`Refusing to overwrite existing archive: ${archivePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await run("pg_dump", [
    "--dbname",
    databaseUrl,
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    "--file",
    archivePath,
  ]);
  await run("pg_restore", ["--list", archivePath], { stdio: ["ignore", "ignore", "inherit"] });
  const metadata = {
    format: "postgres-custom",
    createdAt: new Date().toISOString(),
    bytes: (await stat(archivePath)).size,
    sha256: await sha256(archivePath),
  };
  await writeFile(`${archivePath}.json`, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ event: "postgres.backup.complete", archivePath, ...metadata }));
} else {
  if (confirmation !== "--confirm-empty-target") {
    throw new Error("Restore requires --confirm-empty-target");
  }
  const metadata = JSON.parse(await readFile(`${archivePath}.json`, "utf8"));
  if (
    metadata.format !== "postgres-custom" ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
    metadata.bytes !== (await stat(archivePath)).size ||
    metadata.sha256 !== (await sha256(archivePath))
  ) {
    throw new Error(
      "Archive checksum or size does not match its backup metadata; no changes were made",
    );
  }
  await run("pg_restore", ["--list", archivePath], { stdio: ["ignore", "ignore", "inherit"] });

  let tableCount = "";
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      "psql",
      [
        "--dbname",
        databaseUrl,
        "--tuples-only",
        "--no-align",
        "--command",
        "select count(*) from pg_catalog.pg_tables where schemaname = 'public'",
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    child.stdout.on("data", (chunk) => {
      tableCount += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error("psql failed")),
    );
  });
  if (Number.parseInt(tableCount.trim(), 10) !== 0) {
    throw new Error("Restore target is not empty; no changes were made");
  }

  await run("pg_restore", [
    "--dbname",
    databaseUrl,
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-privileges",
    archivePath,
  ]);
  console.log(
    JSON.stringify({
      event: "postgres.restore.complete",
      archivePath,
      restoredAt: new Date().toISOString(),
    }),
  );
}
