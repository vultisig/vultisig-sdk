import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./run-npm-audit.mjs", import.meta.url));
const now = "2026-01-20T00:00:00.000Z";
const cliTest = process.platform === "win32" ? test.skip : test;

const advisory = (packageName, installed = "1.0.0") => ({
  value: packageName,
  children: {
    ID: 1234,
    Issue: `${packageName} test advisory`,
    URL: `https://example.test/${packageName}`,
    Severity: "high",
    "Vulnerable Versions": ">=1.0.0 <1.1.0",
    "Tree Versions": [installed],
    Dependents: ["fixture@workspace:."],
  },
});

const packageMetadata = (fixPublishedAt) => ({
  versions: { "1.0.0": {}, "1.1.0": {} },
  time: {
    "1.0.0": "2025-01-01T00:00:00.000Z",
    "1.1.0": fixPublishedAt,
  },
});

const withVulnerableRange = (entry, vulnerableRange) => ({
  ...entry,
  children: {
    ...entry.children,
    "Vulnerable Versions": vulnerableRange,
  },
});

const runAudit = ({ advisories = [], metadata = {}, extraArgs = [] } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "run-npm-audit-"));
  writeFileSync(
    join(dir, "audit.ndjson"),
    advisories.map((entry) => JSON.stringify(entry)).join("\n"),
  );
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata));

  const result = spawnSync(
    process.execPath,
    [
      script,
      "--audit-file",
      "audit.ndjson",
      "--metadata-file",
      "metadata.json",
      "--now",
      now,
      ...extraArgs,
    ],
    { cwd: dir, encoding: "utf8", timeout: 5000 },
  );
  rmSync(dir, { recursive: true, force: true });
  return result;
};

const runTransientFixture = async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "run-npm-audit-retry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = join(dir, "fixture.cjs");
  const countPath = join(dir, "count");
  writeFileSync(
    fixture,
    `const fs = require("node:fs");
const countPath = process.env.AUDIT_TEST_COUNT;
const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, "utf8")) + 1 : 1;
fs.writeFileSync(countPath, String(count));
const expected = ["npm", "audit", "--recursive", "--all", "--severity", "high", "--json"];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(99);
if (count === 1) { console.error("ECONNRESET"); process.exit(1); }
`,
  );
  writeFileSync(join(dir, "yarn"), `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, {
    mode: 0o755,
  });
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      AUDIT_TEST_COUNT: countPath,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return {
    code,
    stdout,
    stderr,
    attempts: Number(readFileSync(countPath, "utf8")),
  };
};

const runRegistryTimeoutFixture = async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "run-npm-audit-timeout-"));
  const server = createServer(() => {});
  t.after(() => {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  writeFileSync(join(dir, "audit.ndjson"), JSON.stringify(advisory("timeout")));
  const child = spawn(
    process.execPath,
    [
      script,
      "--audit-file",
      "audit.ndjson",
      "--registry",
      `http://127.0.0.1:${address.port}`,
      "--registry-timeout-ms",
      "50",
      "--now",
      now,
    ],
    { cwd: dir },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const killTimer = setTimeout(() => child.kill(), 2_000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  clearTimeout(killTimer);
  return { code, stdout, stderr };
};

test("actionable advisory exits 1 and prints the merge-main hint", () => {
  const result = runAudit({
    advisories: [advisory("actionable")],
    metadata: { actionable: packageMetadata("2026-01-01T00:00:00.000Z") },
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /actionable.*yes.*ACTIONABLE \(fix 1\.1\.0 installable since 2026-01-15\)/,
  );
  assert.match(result.stderr, /merge main into your branch/);
});

test("young fix is deferred with its exact release-age clearance date", () => {
  const result = runAudit({
    advisories: [advisory("young-fix")],
    metadata: { "young-fix": packageMetadata("2026-01-10T00:00:00.000Z") },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /young-fix.*no.*DEFERRED.*2026-01-24/);
  assert.match(result.stderr, /WARN: deferred npm audit advisories/);
});

test("advisory with no published fix is deferred", () => {
  const result = runAudit({
    advisories: [advisory("no-fix")],
    metadata: {
      "no-fix": {
        versions: { "1.0.0": {} },
        time: { "1.0.0": "2025-01-01T00:00:00.000Z" },
      },
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /no-fix.*no.*DEFERRED \(no fix published\)/);
  assert.match(result.stderr, /WARN: deferred npm audit advisories/);
});

test("mixed results block only the actionable advisory", () => {
  const result = runAudit({
    advisories: [advisory("blocking"), advisory("waiting")],
    metadata: {
      blocking: packageMetadata("2026-01-01T00:00:00.000Z"),
      waiting: packageMetadata("2026-01-10T00:00:00.000Z"),
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /blocking.*yes.*ACTIONABLE/);
  assert.match(result.stdout, /waiting.*no.*DEFERRED/);
  assert.match(result.stderr, /BLOCKING:[\s\S]*- blocking:/);
  assert.doesNotMatch(result.stderr, /BLOCKING:[\s\S]*- waiting:/);
});

test("strict mode exits 1 for a deferred advisory", () => {
  const result = runAudit({
    advisories: [advisory("strict-waiting")],
    metadata: {
      "strict-waiting": packageMetadata("2026-01-10T00:00:00.000Z"),
    },
    extraArgs: ["--strict"],
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /strict mode treats every advisory as blocking/);
  assert.doesNotMatch(result.stderr, /merge main into your branch/);
});

test("empty audit exits 0", () => {
  const result = runAudit();

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No high\/critical npm audit advisories found/);
});

test("registry metadata failure exits 1 and fails closed", () => {
  const result = runAudit({ advisories: [advisory("missing-metadata")] });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing-metadata.*yes.*ACTIONABLE.*failed closed/);
  assert.match(result.stdout, /metadata fixture missing package missing-metadata/);
});

test("empty vulnerable range exits 1 and fails closed", () => {
  const result = runAudit({
    advisories: [withVulnerableRange(advisory("empty-range"), "")],
    metadata: { "empty-range": packageMetadata("2026-01-01T00:00:00.000Z") },
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /empty-range.*yes.*ACTIONABLE \(classification failed closed: unparseable vulnerable range ""\)/,
  );
});

test("invalid vulnerable range exits 1 and fails closed", () => {
  const result = runAudit({
    advisories: [withVulnerableRange(advisory("invalid-range"), "not a range")],
    metadata: {
      "invalid-range": packageMetadata("2026-01-01T00:00:00.000Z"),
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /unparseable vulnerable range "not a range"/);
});

test("comma-separated vulnerable range is treated as an intersection", () => {
  const result = runAudit({
    advisories: [withVulnerableRange(advisory("comma-range", "2.0.0"), ">=1.1.0, <2.0.8")],
    metadata: {
      "comma-range": {
        versions: { "2.0.0": {}, "2.0.7": {}, "2.0.8": {} },
        time: {
          "2.0.0": "2025-01-01T00:00:00.000Z",
          "2.0.7": "2025-12-01T00:00:00.000Z",
          "2.0.8": "2026-01-10T00:00:00.000Z",
        },
      },
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /DEFERRED \(fix 2\.0\.8 clears.*2026-01-24\)/);
  assert.doesNotMatch(result.stdout, /fix 2\.0\.7/);
});

test("lowest fixed version wins over an older higher-major release", () => {
  const result = runAudit({
    advisories: [withVulnerableRange(advisory("backport", "1.4.0"), "<1.4.1 || >=2.0.0 <2.1.0")],
    metadata: {
      backport: {
        versions: { "1.4.0": {}, "1.4.1": {}, "2.1.0": {} },
        time: {
          "1.4.0": "2025-01-01T00:00:00.000Z",
          "1.4.1": "2026-01-18T00:00:00.000Z",
          "2.1.0": "2025-06-20T00:00:00.000Z",
        },
      },
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /DEFERRED \(fix 1\.4\.1 clears.*2026-02-01\)/);
  assert.doesNotMatch(result.stdout, /fix 2\.1\.0/);
});

test("major-only fix is actionable with an explicit upgrade note", () => {
  const result = runAudit({
    advisories: [withVulnerableRange(advisory("major-fix", "1.4.0"), "<2.1.0")],
    metadata: {
      "major-fix": {
        versions: { "1.4.0": {}, "2.1.0": {} },
        time: {
          "1.4.0": "2025-01-01T00:00:00.000Z",
          "2.1.0": "2026-01-18T00:00:00.000Z",
        },
      },
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ACTIONABLE \(fix 2\.1\.0 requires a major upgrade\)/);
});

for (const [name, fixture] of [
  ["empty object", {}],
  ["registry error", { error: "Not found" }],
]) {
  test(`malformed registry metadata (${name}) exits 1 and fails closed`, () => {
    const result = runAudit({
      advisories: [advisory("malformed")],
      metadata: { malformed: fixture },
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /ACTIONABLE \(classification failed closed: malformed registry metadata\)/,
    );
  });
}

test("stable release can fix an installed prerelease", () => {
  const result = runAudit({
    advisories: [withVulnerableRange(advisory("prerelease", "1.0.0-beta.2"), "<1.0.0")],
    metadata: {
      prerelease: {
        versions: {
          "1.0.0-beta.2": {},
          "1.0.0-beta.3": {},
          "1.0.0": {},
        },
        time: {
          "1.0.0-beta.2": "2025-12-01T00:00:00.000Z",
          "1.0.0-beta.3": "2025-12-15T00:00:00.000Z",
          "1.0.0": "2026-01-01T00:00:00.000Z",
        },
      },
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /ACTIONABLE \(fix 1\.0\.0 installable since 2026-01-15\)/);
});

cliTest("registry metadata lookup times out and fails closed", async (t) => {
  const result = await runRegistryTimeoutFixture(t);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /timeout.*yes.*ACTIONABLE.*failed closed/);
  assert.match(result.stdout, /metadata lookup timed out after 50ms/);
});

cliTest("transient audit error retries and recovery exits 0", async (t) => {
  const result = await runTransientFixture(t);

  assert.equal(result.code, 0);
  assert.equal(result.attempts, 2);
  assert.match(result.stderr, /ECONNRESET/);
  assert.match(result.stderr, /retrying in 5s/);
  assert.doesNotMatch(result.stderr, /quality:audit failed/);
});
