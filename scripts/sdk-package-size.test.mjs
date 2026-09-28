import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { inventoryExtractedPackage, validateNoEmbeddedSourceMaps, validateSdkPackSize } from './sdk-package-size.mjs'

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

test('measures every extracted file, including nested node_modules', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-package-size-'))
  try {
    mkdirSync(path.join(root, 'dist'), { recursive: true })
    mkdirSync(path.join(root, 'node_modules', 'hidden'), { recursive: true })
    writeFileSync(path.join(root, 'dist', 'index.js'), 'ok')
    writeFileSync(path.join(root, 'node_modules', 'hidden', 'extra.js.map'), 'map')
    const inventory = inventoryExtractedPackage(root)
    assert.equal(inventory[0].unpackedSize, 5)
    assert.deepEqual(
      inventory[0].files.map(file => file.path).sort(),
      ['dist/index.js', 'node_modules/hidden/extra.js.map']
    )
    assert.throws(() => validateSdkPackSize(inventory, limits), /source maps/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('counts nested node_modules bytes against the size budget', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-package-size-'))
  try {
    mkdirSync(path.join(root, 'node_modules', 'hidden'), { recursive: true })
    writeFileSync(path.join(root, 'index.js'), 'ok')
    writeFileSync(path.join(root, 'node_modules', 'hidden', 'extra.bin'), Buffer.alloc(109))
    assert.throws(() => validateSdkPackSize(inventoryExtractedPackage(root), limits), /exceeds budget/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects inline source maps and source content in packed CSS and JavaScript', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-package-size-'))
  try {
    mkdirSync(path.join(root, 'dist'), { recursive: true })
    const css = path.join(root, 'dist', 'style.css')
    const js = path.join(root, 'dist', 'index.js')
    writeFileSync(css, 'body{}\n/*# sourceMappingURL=data:application/json;base64,e30= */')
    writeFileSync(js, 'export {}')
    assert.throws(
      () => validateNoEmbeddedSourceMaps(root, inventoryExtractedPackage(root)[0].files),
      /source maps in dist\/style\.css/
    )
    writeFileSync(css, 'body{}\n/* sourcesContent */')
    assert.throws(
      () => validateNoEmbeddedSourceMaps(root, inventoryExtractedPackage(root)[0].files),
      /source content in dist\/style\.css/
    )
    writeFileSync(css, 'body{}')
    writeFileSync(js, '//# sourceMappingURL=data:application/json;base64,e30=')
    assert.throws(
      () => validateNoEmbeddedSourceMaps(root, inventoryExtractedPackage(root)[0].files),
      /source maps in dist\/index\.js/
    )
    writeFileSync(js, 'export {}')
    assert.doesNotThrow(() => validateNoEmbeddedSourceMaps(root, inventoryExtractedPackage(root)[0].files))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
