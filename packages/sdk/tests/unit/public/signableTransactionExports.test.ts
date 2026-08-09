import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('signable transaction public exports', () => {
  it('exports the contract from the shared and curated React Native entry points', () => {
    const sdkRoot = resolve(__dirname, '../../..')
    const sharedEntry = readFileSync(resolve(sdkRoot, 'src/index.ts'), 'utf8')
    const reactNativeEntry = readFileSync(resolve(sdkRoot, 'src/platforms/react-native/index.ts'), 'utf8')

    expect(sharedEntry).toContain("export * from './signable-transaction'")
    expect(reactNativeEntry).toContain("export * from '../../signable-transaction'")
  })
})
