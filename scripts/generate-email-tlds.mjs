import { writeFile } from "node:fs/promises";

const source = "https://data.iana.org/TLD/tlds-alpha-by-domain.txt";
const response = await fetch(source);
if (!response.ok) throw new Error("Could not download the IANA top-level-domain list");

const lines = (await response.text()).split(/\r?\n/);
const version = lines[0]?.startsWith("# Version ") ? lines[0].slice(2) : null;
const domains = lines
  .slice(1)
  .map((line) => line.trim().toLowerCase())
  .filter((line) => /^[a-z0-9-]+$/.test(line))
  .toSorted();
if (!version || domains.length < 1_000) throw new Error("IANA returned an invalid TLD list");

const output =
  "/** Generated from " +
  source +
  " · " +
  version +
  ". */\nexport const IANA_TOP_LEVEL_DOMAINS = new Set(\n  " +
  JSON.stringify(domains.join(",")) +
  '.split(\n    ",",\n  ),\n);\n';
await writeFile(new URL("../lib/shared/iana-tlds.ts", import.meta.url), output);
