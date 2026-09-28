import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('signable transaction public exports', () => {
  it('publishes a dedicated runtime and declaration bundle', () => {
    const sdkRoot = resolve(__dirname, '../../..')
    const manifest = JSON.parse(readFileSync(resolve(sdkRoot, 'package.json'), 'utf8'))
    const platformConfig = readFileSync(resolve(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
    const typesConfig = readFileSync(resolve(sdkRoot, 'rollup.types.config.js'), 'utf8')
    const dist = './dist/signable-transaction/index'

    expect(manifest.exports['./signable-transaction']).toEqual({
      types: `${dist}.d.ts`,
      node: { import: `${dist}.js`, require: `${dist}.cjs` },
      import: `${dist}.js`,
      require: `${dist}.cjs`,
      default: `${dist}.cjs`,
    })
    expect(platformConfig).toContain("input: './src/signable-transaction/index.ts'")
    expect(platformConfig).toContain("distBase: 'signable-transaction'")
    expect(typesConfig).toContain(
      "createSubpathTypesConfig('src/signable-transaction/index.ts', 'dist/signable-transaction/index.d.ts')"
    )
  })

  it('exports the contract from the shared and curated React Native entry points', () => {
    const sdkRoot = resolve(__dirname, '../../..')
    const sharedEntry = readFileSync(resolve(sdkRoot, 'src/index.ts'), 'utf8')
    const reactNativeEntry = readFileSync(resolve(sdkRoot, 'src/platforms/react-native/index.ts'), 'utf8')

    expect(sharedEntry).toContain("export * from './signable-transaction'")
    expect(reactNativeEntry).toContain("export * from '../../signable-transaction'")
  })
})
