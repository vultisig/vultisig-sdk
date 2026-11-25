/**
 * `fromStorage` is how every saved vault is loaded. It used to copy the
 * persisted `chains` strings straight into the runtime chain list, so a vault
 * saved while a chain was still supported (Blast, Kujira) came back listing
 * it after the SDK removed that chain, and every lookup keyed on it
 * (`chainFeeCoin`, `chainRegistry`, RPC tables, …) threw at the point of use.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { VaultData } from '../../../src/types'
import { FastVault } from '../../../src/vault/FastVault'
import { SecureVault } from '../../../src/vault/SecureVault'

vi.mock('../../../src/services/SecureVaultCreationService', () => ({
  SecureVaultCreationService: vi.fn(function (this: object) {
    Object.assign(this, {})
  }),
}))
vi.mock('../../../src/services/RelaySigningService', () => ({
  RelaySigningService: vi.fn(function (this: object) {
    Object.assign(this, {})
  }),
}))

const context = () =>
  ({
    storage: new MemoryStorage(),
    config: {},
    serverManager: {},
    passwordCache: {},
    wasmProvider: { getWalletCore: async () => ({}) },
  }) as never

const vaultData = (type: VaultData['type'], chains: string[]): VaultData => ({
  id: `${type}-persisted-chains`,
  name: 'Persisted chains vault',
  type,
  vultFileContent: '',
  isEncrypted: type === 'fast',
  // A `Server-` signer is what marks a vault as fast.
  signers: type === 'fast' ? ['device-1', 'Server-1'] : ['device-1', 'device-2'],
  localPartyId: 'device-1',
  publicKeys: { ecdsa: '02abc', eddsa: 'aa' },
  hexChainCode: 'bb',
  libType: 'DKLS',
  createdAt: Date.now(),
  isBackedUp: true,
  order: 0,
  lastModified: Date.now(),
  currency: 'usd',
  chains,
  tokens: {},
})

const loaders = {
  secure: (chains: string[]) => SecureVault.fromStorage(vaultData('secure', chains), context()),
  fast: (chains: string[]) => FastVault.fromStorage(vaultData('fast', chains), {} as never, context()),
}

describe.each(Object.entries(loaders))('%s vault fromStorage — persisted chains', (_type, load) => {
  it('drops Blast, which the SDK no longer supports', () => {
    expect(load([Chain.Bitcoin, 'Blast', Chain.Ethereum]).chains).toEqual([Chain.Bitcoin, Chain.Ethereum])
  })

  it('drops any other persisted chain missing from the Chain union', () => {
    const supported = new Set<string>(Object.values(Chain))

    for (const chain of load([Chain.Osmosis, 'Kujira', 'NotAChain', '']).chains) {
      expect(supported.has(chain)).toBe(true)
    }
  })

  it('keeps every still-supported chain in order', () => {
    const chains = [Chain.Ethereum, Chain.Bitcoin, Chain.Mantle, Chain.THORChain]

    expect(load(chains).chains).toEqual(chains)
  })
})
