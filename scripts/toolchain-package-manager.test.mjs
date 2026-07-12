import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { formatCiToolchain, getPinnedYarnVersion } from './toolchain-package-manager.mjs'

function withPackageJson(contents, callback) {
  const root = mkdtempSync(join(tmpdir(), 'vultisig-toolchain-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify(contents))

  try {
    return callback(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

test('reads the pinned Yarn version from packageManager', () => {
  withPackageJson({ packageManager: 'yarn@4.16.0' }, root => {
    assert.equal(getPinnedYarnVersion(root), '4.16.0')
    assert.equal(formatCiToolchain(root), 'Node.js 20 and Yarn 4.16.0')
  })
})

test('rejects missing or non-Yarn packageManager values', () => {
  const invalidValues = [undefined, 'pnpm@9.0.0', 'yarn@latest', 'yarn@^4.16.0', 'yarn@4']

  for (const packageManager of invalidValues) {
    withPackageJson({ packageManager }, root => {
      assert.throws(() => getPinnedYarnVersion(root), /packageManager to pin yarn/)
    })
  }
})
