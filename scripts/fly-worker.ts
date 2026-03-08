#!/usr/bin/env tsx

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const APP_NAME = process.env.FLY_TRANSFER_WORKER_APP ?? "party-guest-list-transfer-worker";
const FLY_TOML = "deploy/fly-transfer-worker/fly.toml";
const REQUIRED_SECRET_KEYS = [
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY",
  "R2_SECRET_KEY",
  "R2_BUCKET",
] as const;
const DIRECT_REDIS_SECRET_KEYS = [
  "REDIS_URL",
  "UPSTASH_REDIS_URL",
  "UPSTASH_REDIS_HOST",
  "UPSTASH_REDIS_PORT",
  "UPSTASH_REDIS_PASSWORD",
  "UPSTASH_REDIS_USERNAME",
] as const;

type CommandName =
  | "deploy"
  | "logs"
  | "status"
  | "machines"
  | "restart-all"
  | "sync-secrets"
  | "help";

function loadEnvFile(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const result: Record<string, string> = {};
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

function runFly(args: string[]) {
  const result = spawnSync("fly", args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function syncSecrets() {
  const env = loadEnvFile();
  const missing = REQUIRED_SECRET_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required keys in .env.local: ${missing.join(", ")}`);
  }

  const hasDirectRedisUrl = !!env.REDIS_URL || !!env.UPSTASH_REDIS_URL;
  const hasDirectRedisParts =
    !!env.UPSTASH_REDIS_HOST &&
    !!env.UPSTASH_REDIS_PORT &&
    !!env.UPSTASH_REDIS_PASSWORD;
  if (!hasDirectRedisUrl && !hasDirectRedisParts) {
    throw new Error(
      "Missing direct Redis settings in .env.local. Set REDIS_URL/UPSTASH_REDIS_URL or UPSTASH_REDIS_HOST, UPSTASH_REDIS_PORT, UPSTASH_REDIS_PASSWORD."
    );
  }

  const args = [
    "secrets",
    "set",
    ...REQUIRED_SECRET_KEYS.map((key) => `${key}=${env[key]}`),
    ...DIRECT_REDIS_SECRET_KEYS.filter((key) => env[key]).map((key) => `${key}=${env[key]}`),
    "-a",
    APP_NAME,
  ];
  runFly(args);
}

function listMachinesRaw(): string {
  const result = spawnSync("fly", ["machine", "list", "-a", APP_NAME], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function restartAllMachines() {
  const output = listMachinesRaw();
  const ids = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[a-f0-9]{14,}/.test(line))
    .map((line) => line.split(/\s+/)[0]);

  if (ids.length === 0) {
    console.log("No machines found.");
    return;
  }

  for (const id of ids) {
    runFly(["machine", "restart", id, "-a", APP_NAME]);
  }
}

function printHelp() {
  console.log(`fly worker commands

pnpm fly:worker                Interactive menu
pnpm fly:worker -- deploy      Deploy worker
pnpm fly:worker -- logs        Tail worker logs
pnpm fly:worker -- status      Show app status
pnpm fly:worker -- machines    List machines
pnpm fly:worker -- restart-all Restart all machines
pnpm fly:worker -- sync-secrets Sync required Redis/R2 + direct Redis secrets from .env.local
`);
}

async function interactive() {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(`Fly worker: ${APP_NAME}`);
    console.log("1. deploy");
    console.log("2. logs");
    console.log("3. status");
    console.log("4. machines");
    console.log("5. restart all");
    console.log("6. sync secrets from .env.local");
    console.log("7. help");
    const answer = (await rl.question("Choose an action [1-7]: ")).trim();
    if (answer === "1") runFly(["deploy", "-c", FLY_TOML]);
    else if (answer === "2") runFly(["logs", "-a", APP_NAME]);
    else if (answer === "3") runFly(["status", "-a", APP_NAME]);
    else if (answer === "4") runFly(["machine", "list", "-a", APP_NAME]);
    else if (answer === "5") restartAllMachines();
    else if (answer === "6") syncSecrets();
    else printHelp();
  } finally {
    rl.close();
  }
}

async function main() {
  const raw = process.argv[2];
  const subcommand = (raw === "--" ? process.argv[3] : raw) as CommandName | undefined;

  if (!subcommand) {
    await interactive();
  } else if (subcommand === "deploy") {
    runFly(["deploy", "-c", FLY_TOML]);
  } else if (subcommand === "logs") {
    runFly(["logs", "-a", APP_NAME]);
  } else if (subcommand === "status") {
    runFly(["status", "-a", APP_NAME]);
  } else if (subcommand === "machines") {
    runFly(["machine", "list", "-a", APP_NAME]);
  } else if (subcommand === "restart-all") {
    restartAllMachines();
  } else if (subcommand === "sync-secrets") {
    syncSecrets();
  } else {
    printHelp();
  }
}

void main();
