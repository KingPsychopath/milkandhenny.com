import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const policies = [
  {
    game: "hot-and-cold",
    versionFile: "features/things/hot-and-cold/hot-and-cold-rules.ts",
    versionPattern: /HOT_AND_COLD_JUDGING_VERSION\s*=\s*"(\d+\.\d+\.\d+)"/,
    assetPatterns: [
      /^runtime-assets\/hot-and-cold\/lexicon\.data$/,
      /^runtime-assets\/hot-and-cold\/ranks-\d+\.data$/,
    ],
  },
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function usableBase(value) {
  return value && !/^0+$/.test(value) ? value : "HEAD^";
}

function versionFrom(source, policy, location, required = true) {
  const version = source.match(policy.versionPattern)?.[1];
  if (!version && required)
    throw new Error(`Could not read ${policy.game} judging version from ${location}`);
  return version;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

const base = usableBase(argument("--base") ?? process.env.GAME_JUDGING_BASE);
const changed = git("diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`)
  .split("\n")
  .filter(Boolean);
const failures = [];

for (const policy of policies) {
  const changedAssets = changed.filter((file) =>
    policy.assetPatterns.some((pattern) => pattern.test(file)),
  );
  if (changedAssets.length === 0) continue;
  const previousSource = git("show", `${base}:${policy.versionFile}`);
  const currentSource = readFileSync(policy.versionFile, "utf8");
  const previousVersion =
    versionFrom(previousSource, policy, `${base}:${policy.versionFile}`, false) ?? "0.0.0";
  const currentVersion = versionFrom(currentSource, policy, policy.versionFile);
  if (compareVersions(currentVersion, previousVersion) <= 0) {
    failures.push(
      `${policy.game}: judging assets changed without a version increase (${previousVersion} → ${currentVersion})\n  ${changedAssets.join("\n  ")}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`Game judging revision check failed:\n\n${failures.join("\n\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Game judging revisions match changed assets (${base.slice(0, 12)}...HEAD)`);
}
