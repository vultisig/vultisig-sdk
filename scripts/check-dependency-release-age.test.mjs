import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-dependency-release-age.mjs", import.meta.url));

const writeFixtureRepo = ({ resolutions = {}, lockEntries = [], metadata = {} } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "dependency-release-age-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "fixture",
      workspaces: ["packages/*"],
      dependencies: { postcss: "^8.5.18", aliaspkg: "npm:postcss@^8.5.18" },
      resolutions: { postcss: "^8.5.18", ...resolutions },
    }),
  );
  writeFileSync(
    join(dir, "yarn.lock"),
    [
      "# generated",
      "",
      '"aliaspkg@npm:postcss@^8.5.18", "postcss@npm:^8.5.18":',
      "  version: 8.5.22",
      '  resolution: "postcss@npm:8.5.22"',
      "  languageName: node",
      "  linkType: hard",
      "",
      ...lockEntries,
      '"postcss@npm:^8.4.0":',
      "  version: 8.5.23",
      '  resolution: "postcss@npm:8.5.23"',
      "  languageName: node",
      "  linkType: hard",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      postcss: {
        time: {
          "8.5.22": "2026-07-22T12:00:00.000Z",
          "8.5.23": "2026-08-03T12:00:00.000Z",
        },
      },
      ...metadata,
    }),
  );
  return dir;
};

const runCheck = (cwd, now) =>
  execFileSync(
    process.execPath,
    [script, "--now", now, "--metadata-file", "metadata.json"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 },
  );

const expectCheckFailure = (cwd, now, pattern) => {
  let error;
  try {
    runCheck(cwd, now);
  } catch (caught) {
    error = caught;
  }
  assert(error);
  assert.match(error.stderr, pattern);
  return error;
};

test("dependency release age check fails for a young direct dependency", () => {
  const cwd = writeFixtureRepo();
  const error = expectCheckFailure(cwd, "2026-08-04T00:00:00.000Z", /younger than 14 days/);
  assert.match(error.stderr, /postcss@8\.5\.22/);
});

test("dependency release age check passes once the direct dependency has aged out", () => {
  const cwd = writeFixtureRepo();
  const output = runCheck(cwd, "2026-08-06T12:00:00.000Z");
  assert.match(output, /all are at least 14 days old/);
});

test("parent-qualified resolution checks the target package", () => {
  const cwd = writeFixtureRepo({
    resolutions: { "webpack/memory-fs": "^0.5.0" },
    lockEntries: [
      '"memory-fs@npm:^0.5.0":',
      "  version: 0.5.0",
      '  resolution: "memory-fs@npm:0.5.0"',
      "",
    ],
    metadata: { "memory-fs": { time: { "0.5.0": "2026-08-03T12:00:00.000Z" } } },
  });
  expectCheckFailure(cwd, "2026-08-04T00:00:00.000Z", /memory-fs@0\.5\.0/);
});

test("patched npm resolution checks its underlying version", () => {
  const cwd = writeFixtureRepo({
    resolutions: { "bigint-buffer@npm:^1.1.5": "patch:bigint-buffer@npm%3A1.1.5#./patches/bigint-buffer.patch" },
    lockEntries: [
      '"bigint-buffer@patch:bigint-buffer@npm%3A1.1.5#./patches/bigint-buffer.patch":',
      "  version: 1.1.5",
      '  resolution: "bigint-buffer@patch:bigint-buffer@npm%3A1.1.5#./patches/bigint-buffer.patch::version=1.1.5&hash=abc"',
      "",
    ],
    metadata: { "bigint-buffer": { time: { "1.1.5": "2026-08-03T12:00:00.000Z" } } },
  });
  expectCheckFailure(cwd, "2026-08-04T00:00:00.000Z", /bigint-buffer@1\.1\.5/);
});

test("invalid publication time fails closed", () => {
  const cwd = writeFixtureRepo({
    metadata: { postcss: { time: { "8.5.22": "not-a-date" } } },
  });
  expectCheckFailure(cwd, "2026-08-06T12:00:00.000Z", /postcss@8\.5\.22/);
});
