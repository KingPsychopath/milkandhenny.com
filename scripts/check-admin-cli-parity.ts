import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { normaliseControlPath } from "./admin-control";

const ROOT = path.resolve("features/admin/ui");
const API_PATH = /["'`]((?:\/api\/)[^"'`\s)]+)/g;
const NAMED_CLI_SURFACES = [
  "/api/upload/words/finalize",
  "/api/upload/words/presign",
  "/api/words",
  "/api/words/",
] as const;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(target)
        : Promise.resolve(/\.[cm]?[jt]sx?$/.test(entry.name) ? [target] : []);
    }),
  );
  return nested.flat();
}

const uncovered = new Set<string>();
for (const file of await sourceFiles(ROOT)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(API_PATH)) {
    const candidate = match[1].split("${", 1)[0].replace(/[?&#].*$/, "");
    if (NAMED_CLI_SURFACES.some((surface) => candidate.startsWith(surface))) continue;
    try {
      normaliseControlPath(candidate, "GET");
    } catch {
      uncovered.add(candidate);
    }
  }
}

if (uncovered.size > 0) {
  throw new Error(
    `Admin UI API surfaces missing generic CLI access:\n${[...uncovered]
      .sort()
      .map((value) => `- ${value}`)
      .join("\n")}`,
  );
}

process.stdout.write("Admin UI API surfaces have generic CLI access.\n");
