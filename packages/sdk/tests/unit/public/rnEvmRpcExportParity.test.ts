import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('react-native EVM RPC export parity', () => {
  it('keeps getEvmRpcUrl on the curated RN entry whenever the root SDK entry exports it', () => {
    const sdkRoot = resolve(__dirname, '../../..')
    const sharedEntry = readFileSync(resolve(sdkRoot, 'src/index.ts'), 'utf8')
    const reactNativeEntry = readFileSync(resolve(sdkRoot, 'src/platforms/react-native/index.ts'), 'utf8')

    expect(sharedEntry).toContain('getEvmRpcUrl')
    expect(reactNativeEntry).toContain('getEvmRpcUrl')
  })
})
