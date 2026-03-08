import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const workerPackagePath = path.join(repoRoot, "package.transfer-worker.json");
const workerLockPath = path.join(repoRoot, "deploy", "fly-transfer-worker", "pnpm-lock.yaml");

function runPnpm(cwd: string, args: string[]) {
  const result = spawnSync("pnpm", args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-worker-lock-"));

  try {
    fs.copyFileSync(workerPackagePath, path.join(tempDir, "package.json"));
    runPnpm(tempDir, ["install", "--lockfile-only"]);
    fs.mkdirSync(path.dirname(workerLockPath), { recursive: true });
    fs.copyFileSync(path.join(tempDir, "pnpm-lock.yaml"), workerLockPath);
    console.log(`Updated ${path.relative(repoRoot, workerLockPath)}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
