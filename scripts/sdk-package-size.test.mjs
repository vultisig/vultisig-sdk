import assert from 'node:assert/strict'
import test from 'node:test'

import { validateSdkPackSize } from './sdk-package-size.mjs'

const pack = unpackedSize => [{ unpackedSize, files: [{ path: 'dist/index.js', size: unpackedSize }] }]
const limits = { baselineBytes: 100, hardCapBytes: 200, growthPercent: 10 }

test('accepts the baseline and the exact ten-percent growth boundary', () => {
  assert.equal(validateSdkPackSize(JSON.stringify(pack(100)), limits), 100)
  assert.equal(validateSdkPackSize(pack(110), limits), 110)
  assert.throws(() => validateSdkPackSize(pack(111), limits), /exceeds budget/)
})

test('enforces the hard cap independently of the growth cap', () => {
  const largerBaseline = { ...limits, baselineBytes: 200 }
  assert.equal(validateSdkPackSize(pack(199), largerBaseline), 199)
  assert.throws(() => validateSdkPackSize(pack(200), largerBaseline), /exceeds budget/)
  assert.throws(() => validateSdkPackSize(pack(201), largerBaseline), /exceeds budget/)
})

test('rejects malformed npm output and invalid budgets', () => {
  for (const output of [
    'invalid json',
    {},
    [],
    [null],
    pack(0),
    pack(-1),
    pack(1.5),
    [{ unpackedSize: 100 }],
    [{ unpackedSize: 100, files: [] }],
    [{ unpackedSize: 100, files: [{}] }],
  ]) {
    assert.throws(() => validateSdkPackSize(output, limits))
  }
  const inconsistent = pack(100)
  inconsistent[0].files[0].size = 99
  assert.throws(() => validateSdkPackSize(inconsistent, limits), /do not match/)
  assert.throws(() => validateSdkPackSize([...pack(100), ...pack(100)], limits), /one npm pack/)
  assert.throws(() => validateSdkPackSize(pack(100), { ...limits, baselineBytes: 0 }), /Invalid/)
})

test('rejects maps even when the size passes', () => {
  const output = pack(100)
  output[0].files.push({ path: 'dist/chunks/module.js.map', size: 0 })
  assert.throws(() => validateSdkPackSize(output, limits), /source maps/)
})
