import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isBundledSourceFile } from './check-sdk-bundled-changeset.mjs'

test('SDK changeset guard ignores test-only JSON vectors', () => {
  assert.equal(
    isBundledSourceFile('packages/core/mpc/keysign/signingInputs/fixtures/ripple-interop-vector.test.json'),
    false
  )
  assert.equal(isBundledSourceFile('packages/core/mpc/keysign/signingInputs/fixtures/runtime-vector.json'), true)
})
