#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";

import { BASE_URL } from "@/lib/shared/config";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main() {
  const command = process.argv[2] ?? "get";
  const eventSlug = required("event");
  const token = process.env.MH_ADMIN_TOKEN?.trim();
  const stepUp = process.env.MH_ADMIN_STEP_UP_TOKEN?.trim();
  if (!token) throw new Error("MH_ADMIN_TOKEN is required");
  const endpoint = `${BASE_URL}/api/admin/events/${encodeURIComponent(eventSlug)}/scoring`;
  if (command === "get") {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Scoring request failed (${response.status})`);
    process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
    return;
  }
  if (!stepUp) throw new Error("MH_ADMIN_STEP_UP_TOKEN is required for changes and exports");
  const bodyPath = option("body");
  const inline = option("json");
  const body = bodyPath
    ? (JSON.parse(await readFile(bodyPath, "utf8")) as Record<string, unknown>)
    : inline
      ? (JSON.parse(inline) as Record<string, unknown>)
      : command === "export"
        ? { action: "export" }
        : command === "print"
          ? {
              action: "print-pdf",
              layout: option("layout") ?? "eight-clues",
              paper: option("paper") ?? "a4",
            }
          : null;
  if (!body) throw new Error("Use --json or --body with an admin scoring action");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Admin-Step-Up": stepUp,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `Scoring request failed (${response.status})`);
  }
  const output = option("output");
  if (output) {
    await writeFile(output, Buffer.from(await response.arrayBuffer()));
    process.stdout.write(`${output}\n`);
  } else {
    process.stdout.write(`${await response.text()}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Event scoring command failed"}\n`,
  );
  process.exitCode = 1;
});
