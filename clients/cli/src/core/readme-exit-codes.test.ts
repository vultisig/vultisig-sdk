import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EXIT_CODE_DESCRIPTIONS, ExitCode } from './errors'

// Doc-lint: the README "## Exit Codes" table is shipped in the npm package and
// rendered on npmjs.com. It MUST match the `ExitCode` enum / EXIT_CODE_DESCRIPTIONS
// in errors.ts (the single source of truth also used by `--help` and `schema`).
// A stale table means a script written to the README misclassifies every failure.
const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url))

function parseExitCodeTable(markdown: string): Record<number, string> {
  const lines = markdown.split('\n')
  const heading = lines.findIndex(line => /^#+\s+Exit Codes\s*$/i.test(line))
  if (heading === -1) throw new Error('README is missing the "## Exit Codes" heading')

  const table: Record<number, string> = {}
  for (let i = heading + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^#+\s/.test(line)) break // next section — stop
    // Match rows like: | 3 | Network error (retryable) |
    const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/)
    if (!match) continue
    table[Number(match[1])] = match[2].trim()
  }
  return table
}

describe('README exit-code table', () => {
  const readme = readFileSync(readmePath, 'utf8')
  const documented = parseExitCodeTable(readme)

  const expected: Record<number, string> = Object.fromEntries(
    Object.entries(EXIT_CODE_DESCRIPTIONS).map(([code, desc]) => [Number(code), desc])
  )

  it('documents exactly the codes in the ExitCode enum (no missing, no extra)', () => {
    expect(
      Object.keys(documented)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual(
      Object.keys(expected)
        .map(Number)
        .sort((a, b) => a - b)
    )
  })

  it('matches EXIT_CODE_DESCRIPTIONS verbatim for every code', () => {
    expect(documented).toEqual(expected)
  })

  it('covers every ExitCode enum member', () => {
    const enumCodes = Object.values(ExitCode).filter((v): v is number => typeof v === 'number')
    for (const code of enumCodes) {
      expect(documented, `README table is missing exit code ${code}`).toHaveProperty(String(code))
    }
  })
})
