#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import semver from "semver";

const auditArgs = [
  "npm",
  "audit",
  "--recursive",
  "--all",
  "--severity",
  "high",
  "--json",
];
const maxAttempts = 3;
const retryDelaysMs = [5_000, 15_000];
const transientErrorPattern =
  /RequestError|Timeout awaiting 'socket'|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i;
const defaultMinimumAgeDays = 14;
const dayMs = 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const getArgValue = (name) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const minimumAgeDays = Number(
  getArgValue("--min-age-days") ??
    process.env.DEPENDENCY_RELEASE_MIN_AGE_DAYS ??
    defaultMinimumAgeDays,
);
const now = new Date(
  getArgValue("--now") ?? process.env.DEPENDENCY_RELEASE_AGE_NOW ?? Date.now(),
);
const registryUrl = (
  getArgValue("--registry") ??
  process.env.NPM_REGISTRY_URL ??
  "https://registry.npmjs.org"
).replace(/\/+$/, "");
const auditFile = getArgValue("--audit-file");
const metadataFile =
  getArgValue("--metadata-file") ??
  process.env.DEPENDENCY_RELEASE_METADATA_FILE;
const strict = args.includes("--strict") || process.env.NPM_AUDIT_STRICT === "1";

if (!Number.isFinite(minimumAgeDays) || minimumAgeDays < 0) {
  throw new Error(`Invalid --min-age-days value: ${minimumAgeDays}`);
}
if (Number.isNaN(now.getTime())) {
  throw new Error(`Invalid --now value: ${now}`);
}

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const metadataFixture = metadataFile
  ? readJson(resolve(process.cwd(), metadataFile))
  : undefined;

const fetchPackageMetadata = async (name) => {
  if (metadataFixture) {
    const metadata = metadataFixture[name];
    if (!metadata) throw new Error(`metadata fixture missing package ${name}`);
    return metadata;
  }

  const encodedName = name.startsWith("@")
    ? `@${encodeURIComponent(name.slice(1)).replace("%2F", "%2f")}`
    : encodeURIComponent(name);
  const response = await fetch(`${registryUrl}/${encodedName}`);
  if (!response.ok) {
    throw new Error(
      `npm metadata lookup failed for ${name}: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
};

const parseAuditOutput = (output) =>
  output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

const runAudit = () =>
  spawnSync(process.platform === "win32" ? "yarn.cmd" : "yarn", auditArgs, {
    encoding: "utf8",
    env: process.env,
  });

const loadAdvisories = async () => {
  if (auditFile) {
    return parseAuditOutput(readFileSync(resolve(process.cwd(), auditFile), "utf8"));
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runAudit();
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const output = `${stdout}\n${stderr}`;
    const canRetry =
      result.status !== 0 &&
      attempt < maxAttempts &&
      transientErrorPattern.test(output);

    if (canRetry) {
      const delayMs = retryDelaysMs[attempt - 1];
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      process.stderr.write(
        `npm audit hit a transient network error; retrying in ${delayMs / 1_000}s (${attempt}/${maxAttempts}).\n`,
      );
      await sleep(delayMs);
      continue;
    }

    let advisories;
    try {
      advisories = parseAuditOutput(stdout);
    } catch (error) {
      process.stderr.write(stderr);
      throw new Error(
        `npm audit returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (result.status !== 0 && advisories.length === 0) {
      process.stderr.write(stderr);
      throw new Error(
        `npm audit command failed with exit code ${result.status ?? 1}`,
      );
    }

    return advisories;
  }

  return [];
};

const formatDate = (date) => date.toISOString().slice(0, 10);

const findEarliestFix = (advisory, metadata) => {
  const vulnerableRange = advisory.children?.["Vulnerable Versions"];
  const treeVersions = advisory.children?.["Tree Versions"];
  if (typeof vulnerableRange !== "string" || !Array.isArray(treeVersions)) {
    throw new Error("audit result is missing vulnerable or installed versions");
  }

  const installedVersions = treeVersions.map((version) => semver.valid(version));
  if (installedVersions.some((version) => !version)) {
    throw new Error(`audit result has an invalid installed version: ${treeVersions.join(", ")}`);
  }
  const lowestInstalled = installedVersions.sort(semver.compare)[0];
  if (!lowestInstalled) throw new Error("audit result has no installed versions");

  const allowPrerelease = semver.prerelease(lowestInstalled) !== null;
  const candidates = Object.keys(metadata?.versions ?? {}).filter((version) => {
    const validVersion = semver.valid(version);
    return (
      validVersion &&
      semver.gt(validVersion, lowestInstalled) &&
      !semver.satisfies(validVersion, vulnerableRange) &&
      (allowPrerelease || semver.prerelease(validVersion) === null)
    );
  });

  if (candidates.length === 0) return { lowestInstalled };

  const publishedCandidates = candidates.map((version) => {
    const publishedAt = metadata?.time?.[version];
    const publishedDate = new Date(publishedAt);
    if (!publishedAt || Number.isNaN(publishedDate.getTime())) {
      throw new Error(`registry metadata has no valid publish time for ${version}`);
    }
    return { version, publishedDate };
  });

  publishedCandidates.sort(
    (a, b) =>
      a.publishedDate.getTime() - b.publishedDate.getTime() ||
      semver.compare(a.version, b.version),
  );
  return { lowestInstalled, earliestFix: publishedCandidates[0] };
};

const classifyAdvisory = async (advisory, metadataByPackage) => {
  const packageName = advisory.value;
  const base = {
    packageName,
    severity: advisory.children?.Severity ?? "unknown",
    vulnerableRange: advisory.children?.["Vulnerable Versions"] ?? "unknown",
    url: advisory.children?.URL,
  };

  try {
    if (typeof packageName !== "string" || !packageName) {
      throw new Error("audit result is missing the package name");
    }
    if (!metadataByPackage.has(packageName)) {
      metadataByPackage.set(packageName, await fetchPackageMetadata(packageName));
    }
    const metadata = metadataByPackage.get(packageName);
    const { lowestInstalled, earliestFix } = findEarliestFix(advisory, metadata);

    if (!earliestFix) {
      return {
        ...base,
        installed: lowestInstalled,
        actionable: false,
        classification: "DEFERRED (no fix published)",
      };
    }

    const clearsAt = new Date(
      earliestFix.publishedDate.getTime() + minimumAgeDays * dayMs,
    );
    if (now.getTime() < clearsAt.getTime()) {
      return {
        ...base,
        installed: lowestInstalled,
        actionable: false,
        classification: `DEFERRED (fix ${earliestFix.version} clears the release-age gate on ${formatDate(clearsAt)})`,
      };
    }

    return {
      ...base,
      installed: lowestInstalled,
      actionable: true,
      classification: `ACTIONABLE (fix ${earliestFix.version} installable since ${formatDate(clearsAt)})`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      installed: Array.isArray(advisory.children?.["Tree Versions"])
        ? advisory.children["Tree Versions"].join(", ")
        : "unknown",
      actionable: true,
      classification: `ACTIONABLE (classification failed closed: ${reason})`,
    };
  }
};

const printTable = (classifications) => {
  const headers = ["Package", "Severity", "Installed", "Blocking", "Classification"];
  const rows = classifications.map((item) => [
    item.packageName ?? "unknown",
    item.severity,
    item.installed,
    item.actionable ? "yes" : "no",
    item.classification,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const render = (row) =>
    row.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ");

  process.stdout.write(
    [
      `npm audit advisory classification (minimum release age: ${minimumAgeDays} days)`,
      render(headers),
      widths.map((width) => "-".repeat(width)).join("-+-"),
      ...rows.map(render),
    ].join("\n") + "\n",
  );
};

const main = async () => {
  const advisories = await loadAdvisories();
  if (advisories.length === 0) {
    process.stdout.write("No high/critical npm audit advisories found.\n");
    return;
  }

  const metadataByPackage = new Map();
  const classifications = [];
  for (const advisory of advisories) {
    classifications.push(await classifyAdvisory(advisory, metadataByPackage));
  }
  printTable(classifications);

  const deferred = classifications.filter((item) => !item.actionable);
  const actionable = classifications.filter((item) => item.actionable);
  if (deferred.length) {
    process.stderr.write(
      [
        "",
        "WARN: deferred npm audit advisories (non-blocking):",
        ...deferred.map((item) => `- ${item.packageName}: ${item.classification}`),
        "Update these dependencies when their fixes clear the release-age gate.",
      ].join("\n") + "\n",
    );
  }

  if (actionable.length) {
    process.stderr.write(
      [
        "",
        "BLOCKING: ACTIONABLE npm audit advisories:",
        ...actionable.map(
          (item) => `- ${item.packageName}: ${item.classification}${item.url ? ` (${item.url})` : ""}`,
        ),
        "",
        "quality:audit failed on this lockfile (absolute, not vs origin/main).",
        "If this advisory is already fixed on origin/main, merge main into your branch - that is the whole fix.",
        "This is not a lint or typecheck failure in your change.",
      ].join("\n") + "\n",
    );
  } else if (strict) {
    process.stderr.write(
      "\nquality:audit failed because strict mode treats every advisory as blocking.\n",
    );
  }

  if (actionable.length || (strict && classifications.length)) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
