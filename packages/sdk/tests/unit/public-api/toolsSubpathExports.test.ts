import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const manifest = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const runtimeConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')
const inventory = JSON.parse(readFileSync(path.join(sdkRoot, 'public-subpath-migration.json'), 'utf8'))

const retained = [
  '.',
  './node',
  './browser',
  './react-native',
  './rn-preamble',
  './electron',
  './electron/main',
  './chrome-extension',
  './vite',
]

describe('SDK public package entries', () => {
  it('publishes exactly the platform entries', () => {
    expect(Object.keys(manifest.exports)).toEqual(retained)
    expect(inventory).toHaveLength(19)
    for (const { subpath } of inventory) expect(Object.hasOwn(manifest.exports, subpath)).toBe(false)
  })

  it('does not publish or build the removed agent DeFi API', () => {
    expect(manifest.exports).not.toHaveProperty('./tools/defi')
    expect(manifest.dependencies).not.toHaveProperty('@balancer/sdk')
    expect(manifest.dependencies).toHaveProperty('@noble/ciphers')
    expect(runtimeConfig).not.toContain("distBase: 'tools/defi'")
    expect(typesConfig).not.toContain('src/tools/defi/index.ts')
  })

  it('does not build a removed path as a separate runtime or declaration entry', () => {
    for (const { subpath } of inventory) {
      const distBase = subpath.slice(2)
      expect(runtimeConfig).not.toContain(`distBase: '${distBase}'`)
      expect(typesConfig).not.toContain(`dist/${distBase}/index.d.ts`)
      expect(runtimeConfig).not.toContain(`./dist/${distBase}/index.browser.js`)
      expect(runtimeConfig).not.toContain(`./dist/${distBase}/index.react-native.js`)
    }
  })
})
