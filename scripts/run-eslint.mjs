#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const eslint = join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'eslint.cmd' : 'eslint'
)

if (!existsSync(eslint)) {
  process.stderr.write(
    [
      '[vultisig-local-checks] Missing repo-local ESLint.',
      '',
      'Run from the repository root:',
      '  corepack enable',
      '  yarn install --immutable',
      '',
      'Then rerun `yarn lint`. CI uses Yarn 4.13.0 and the repo-local ESLint binary.',
    ].join('\n') + '\n'
  )
  process.exit(127)
}

const result = spawnSync(eslint, process.argv.slice(2), {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (result.error) {
  process.stderr.write(`[vultisig-local-checks] Failed to run ESLint: ${result.error.message}\n`)
  process.exit(1)
}

process.exit(result.status ?? 1)
