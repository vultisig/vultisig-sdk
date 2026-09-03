import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { VaultBase } from '../../../src/vault/VaultBase'

/**
 * `VaultData.chains` is a persisted `string[]`, not `Chain[]`, so a vault saved
 * while a chain was still supported keeps that raw string in storage after the
 * chain is removed from the SDK. Restoring it unchecked would put a value into
 * `_userChains` that every registry lookup (`chainFeeCoin`, `cosmosRpcUrl`,
 * `chainRegistry`, …) resolves to `undefined`, throwing at the point of use.
 *
 * Kujira is the concrete case: removed once its network went permanently offline.
 */
describe('VaultBase persisted-chain restore', () => {
  const syncFrom = (chains: string[]) => {
    const vault = {
      vaultData: { chains, currency: 'usd', tokens: {}, publicKeys: {}, signers: [] },
      coreVault: {},
      _userChains: [] as Chain[],
      _currency: '',
      _tokens: {},
    }

    VaultBase.prototype['syncRuntimeFromVaultData'].call(vault as never)

    return vault._userChains
  }

  it('drops a persisted chain the SDK no longer supports', () => {
    expect(syncFrom([Chain.Bitcoin, 'Kujira', Chain.Ethereum])).toEqual([Chain.Bitcoin, Chain.Ethereum])
  })

  it('keeps every still-supported chain', () => {
    const chains = [Chain.Bitcoin, Chain.Ethereum, Chain.THORChain, Chain.Cosmos]

    expect(syncFrom(chains)).toEqual(chains)
  })

  it('never yields a chain missing from the canonical union', () => {
    const supported = new Set<string>(Object.values(Chain))

    for (const chain of syncFrom([Chain.Osmosis, 'Kujira', 'NotAChain', ''])) {
      expect(supported.has(chain)).toBe(true)
    }
  })
})
