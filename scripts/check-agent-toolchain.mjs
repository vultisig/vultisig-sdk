#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const nodeModulesBin = join(repoRoot, 'node_modules', '.bin')
const isWindows = process.platform === 'win32'
const args = new Set(process.argv.slice(2))
const typescriptOnly = args.has('--typescript-only')

const binaryPath = name => join(nodeModulesBin, isWindows ? `${name}.cmd` : name)

const setupMessage = tool =>
  [
    `[vultisig-local-checks] Missing repo-local ${tool}.`,
    '',
    'Run from the repository root:',
    '  corepack enable',
    '  yarn install --immutable',
    '',
    'CI uses Node.js 20 and Yarn 4.13.0. Avoid global binaries such as `tsc` or `eslint` for local verification.',
  ].join('\n')

const assertBinary = name => {
  const path = binaryPath(name)

  if (!existsSync(path)) {
    process.stderr.write(`${setupMessage(name)}\n`)
    process.exit(127)
  }

  return path
}

const assertTypeScriptVersion = () => {
  const tsc = assertBinary('tsc')
  let output = ''

  try {
    output = execFileSync(tsc, ['--version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    process.stderr.write(
      `[vultisig-local-checks] Failed to run repo-local TypeScript: ${error.message}\n`
    )
    process.exit(1)
  }

  const version = output.match(/Version\s+(\d+)\.(\d+)\.(\d+)/)
  const major = version ? Number(version[1]) : 0

  if (!version || major < 6) {
    process.stderr.write(
      [
        `[vultisig-local-checks] Repo-local TypeScript is ${output || 'unknown'}, but this repo uses \`ignoreDeprecations: "6.0"\`.`,
        'Run `corepack enable && yarn install --immutable` from the repository root to install the Yarn-pinned TypeScript toolchain.',
        'Do not run a global `tsc`; older TypeScript versions report TS5103 for this repository.',
      ].join('\n') + '\n'
    )
    process.exit(1)
  }
}

if (!typescriptOnly) {
  assertBinary('eslint')
}

assertTypeScriptVersion()
