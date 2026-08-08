import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { definePlugin } from "nitro";
import { log } from "@/lib/platform/logger.server";

/**
 * Fills `process.env` from the local dotenv files in development.
 *
 * Vite hands `.env.local` to the environment that runs server functions, but not to the one that
 * runs Nitro's websocket handlers. The visible symptom is a socket that authorises every hello as
 * unauthorised: `getRedis()` returns null in that context, the engine falls back to its in-memory
 * room map, and that map is empty because every room was written to Redis by the other environment.
 * Every multiplayer game here has the same shape, so all of them showed "offline" in dev while
 * working correctly in production.
 *
 * Production sets real environment variables, so this does nothing there — and it never overwrites
 * a variable that is already present.
 */
const FILES = [".env.local", ".env"];

function parse(contents: string) {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    if (key) values[key] = value;
  }
  return values;
}

export default definePlugin(() => {
  if (process.env.NODE_ENV === "production") return;

  let filled = 0;
  for (const file of FILES) {
    let contents: string;
    try {
      contents = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parse(contents))) {
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
      filled += 1;
    }
  }

  if (filled > 0)
    log.info("platform.env", "Filled development environment for the Nitro context", { filled });
});
