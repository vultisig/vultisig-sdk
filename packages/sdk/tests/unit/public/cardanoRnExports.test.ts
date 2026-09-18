import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('cardano RN public exports', () => {
  it('re-exports the canonical extended UTXO helper and type from the curated RN entry', () => {
    const sdkRoot = resolve(__dirname, '../../..')
    const cardanoEntry = readFileSync(resolve(sdkRoot, 'src/platforms/react-native/chains/cardano/index.ts'), 'utf8')

    expect(cardanoEntry).toContain("export type { CardanoExtendedUtxo } from '@vultisig/core-chain/chains/cardano/utxo/getCardanoExtendedUtxos'")
    expect(cardanoEntry).toContain("export { getCardanoExtendedUtxos } from '@vultisig/core-chain/chains/cardano/utxo/getCardanoExtendedUtxos'")
  })
})
