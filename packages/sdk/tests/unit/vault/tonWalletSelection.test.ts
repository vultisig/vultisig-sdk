/**
 * The TON account a vault acts on is a vault-level selection. `send` and every
 * other flow that looks up "the vault's TON address" must follow it, otherwise
 * a caller who selected W5 through `address()` would sign from V4R2.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { VaultData } from '../../../src/types'
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
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: () => ({}),
}))
vi.mock('@vultisig/core-chain/publicKey/address/deriveAddress', () => ({
  deriveAddress: ({ chain, tonWalletVersion }: { chain: string; tonWalletVersion?: string }) =>
    chain === 'Ton' ? `ton-${tonWalletVersion}` : `${chain.toLowerCase()}-address`,
}))

const vaultData: VaultData = {
  id: 'ton-selection-vault',
  name: 'TON selection vault',
  type: 'secure',
  vultFileContent: '',
  isEncrypted: false,
  signers: ['device-1', 'device-2'],
  localPartyId: 'device-1',
  publicKeys: { ecdsa: '02abc', eddsa: 'aa' },
  hexChainCode: 'bb',
  libType: 'DKLS',
  createdAt: Date.now(),
  isBackedUp: true,
  order: 0,
  lastModified: Date.now(),
  currency: 'usd',
  chains: [],
  tokens: {},
}

const makeVault = () => {
  const context = {
    storage: new MemoryStorage(),
    config: {},
    serverManager: {},
    passwordCache: {},
    wasmProvider: { getWalletCore: async () => ({}) },
  }
  const vault = SecureVault.fromStorage(vaultData, context as never)
  const prepareSendTx = vi.spyOn(vault, 'prepareSendTx').mockResolvedValue({} as never)
  Object.assign(vault, {
    transactionBuilder: { estimateSendFee: vi.fn().mockResolvedValue(0n) },
  })

  return { vault, prepareSendTx }
}

const sentFrom = (prepareSendTx: ReturnType<typeof vi.spyOn>) =>
  (prepareSendTx.mock.calls.at(-1)?.[0] as { coin: { address: string } }).coin.address

describe('vault-level TON wallet selection', () => {
  it('starts on V4R2, the account every existing vault uses', async () => {
    const { vault } = makeVault()

    expect(vault.tonWalletVersion).toBe('v4r2')
    await expect(vault.address(Chain.Ton)).resolves.toBe('ton-v4r2')
  })

  it('previews the other account without moving the vault', async () => {
    const { vault } = makeVault()

    await expect(vault.address(Chain.Ton, { tonWalletVersion: 'v5r1' })).resolves.toBe('ton-v5r1')
    expect(vault.tonWalletVersion).toBe('v4r2')
    await expect(vault.address(Chain.Ton)).resolves.toBe('ton-v4r2')
  })

  it('makes send() build from the selected account', async () => {
    const { vault, prepareSendTx } = makeVault()
    const send = () => vault.send({ chain: Chain.Ton, to: 'UQdest', amount: '1', dryRun: true })

    await send()
    expect(sentFrom(prepareSendTx)).toBe('ton-v4r2')

    await vault.setTonWalletVersion('v5r1')
    await send()
    expect(vault.tonWalletVersion).toBe('v5r1')
    expect(sentFrom(prepareSendTx)).toBe('ton-v5r1')

    await vault.setTonWalletVersion('v4r2')
    await send()
    expect(sentFrom(prepareSendTx)).toBe('ton-v4r2')
  })

  it('leaves other chains alone', async () => {
    const { vault } = makeVault()
    await vault.setTonWalletVersion('v5r1')

    await expect(vault.address(Chain.Ethereum)).resolves.toBe('ethereum-address')
  })
})
