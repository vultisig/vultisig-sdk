import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const script = new URL('./check-dependency-release-age.mjs', import.meta.url)

const writeFixtureRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dependency-release-age-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      workspaces: ['packages/*'],
      dependencies: { postcss: '^8.5.18', aliaspkg: 'npm:postcss@^8.5.18' },
      resolutions: { postcss: '^8.5.18' },
    })
  )
  writeFileSync(
    join(dir, 'yarn.lock'),
    [
      '# generated',
      '',
      '"aliaspkg@npm:postcss@^8.5.18", "postcss@npm:^8.5.18":',
      '  version: 8.5.22',
      '  resolution: "postcss@npm:8.5.22"',
      '  languageName: node',
      '  linkType: hard',
      '',
      '"postcss@npm:^8.4.0":',
      '  version: 8.5.23',
      '  resolution: "postcss@npm:8.5.23"',
      '  languageName: node',
      '  linkType: hard',
      '',
    ].join('\n')
  )
  writeFileSync(
    join(dir, 'metadata.json'),
    JSON.stringify({
      postcss: { time: { '8.5.22': '2026-07-22T12:00:00.000Z', '8.5.23': '2026-08-03T12:00:00.000Z' } },
    })
  )
  return dir
}

test('dependency release age check fails for a young direct dependency', () => {
  const cwd = writeFixtureRepo()
  let error
  try {
    execFileSync(
      process.execPath,
      [script.pathname, '--now', '2026-08-04T00:00:00.000Z', '--metadata-file', 'metadata.json'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }
    )
  } catch (caught) {
    error = caught
  }

  assert(error)
  assert.match(error.stderr, /younger than 14 days/)
  assert.match(error.stderr, /postcss@8\.5\.22/)
})

test('dependency release age check passes once the direct dependency has aged out', () => {
  const cwd = writeFixtureRepo()
  const output = execFileSync(
    process.execPath,
    [script.pathname, '--now', '2026-08-06T12:00:00.000Z', '--metadata-file', 'metadata.json'],
    {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    }
  )
  assert.match(output, /all are at least 14 days old/)
})
