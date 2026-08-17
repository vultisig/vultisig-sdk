import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('signable transaction public exports', () => {
  it('exports the contract from the shared and curated React Native entry points', () => {
    const sdkRoot = resolve(__dirname, '../../..')
    const sharedEntry = readFileSync(resolve(sdkRoot, 'src/index.ts'), 'utf8')
    const reactNativeEntry = readFileSync(resolve(sdkRoot, 'src/platforms/react-native/index.ts'), 'utf8')
    const packageJson = JSON.parse(readFileSync(resolve(sdkRoot, 'package.json'), 'utf8'))
    const platformRollupConfig = readFileSync(resolve(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
    const typesRollupConfig = readFileSync(resolve(sdkRoot, 'rollup.types.config.js'), 'utf8')

    expect(sharedEntry).toContain("export * from './signable-transaction'")
    expect(reactNativeEntry).toContain("export * from '../../signable-transaction'")
    expect(packageJson.exports['./signable-transaction']).toMatchObject({
      types: './dist/signable-transaction/index.d.ts',
      import: './dist/signable-transaction/index.js',
      require: './dist/signable-transaction/index.cjs',
      default: './dist/signable-transaction/index.cjs',
    })
    expect(platformRollupConfig).toContain("input: './src/signable-transaction/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'signable-transaction'")
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/signable-transaction/index.ts', 'dist/signable-transaction/index.d.ts')"
    )
  })
})
