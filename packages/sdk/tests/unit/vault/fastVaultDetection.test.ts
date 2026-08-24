import { Chain } from '@vultisig/core-chain/Chain'
import type { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { describe, expect, it, vi } from 'vitest'

import type { WasmProvider } from '../../../src/context/SdkContext'
import type { ServerManager } from '../../../src/server/ServerManager'
import { FastSigningService } from '../../../src/services/FastSigningService'
import { hasServer, isServer } from '../../../src/vault'

const legacyFastVault = {
  name: 'Legacy Fast Vault',
  publicKeys: { ecdsa: 'ecdsa', eddsa: 'eddsa' },
  signers: ['iPhone-current', 'VultiServer-legacy'],
  hexChainCode: '00'.repeat(32),
  localPartyId: 'iPhone-current',
  keyShares: { ecdsa: 'ecdsa-share', eddsa: 'eddsa-share' },
  resharePrefix: '',
  libType: 'DKLS',
  createdAt: 1,
  isBackedUp: true,
  order: 0,
} as CoreVault

describe('canonical fast-vault detection', () => {
  it('recognizes current and legacy server signers without accepting prefix lookalikes', () => {
    expect(isServer('Server-current')).toBe(true)
    expect(isServer('server-current')).toBe(true)
    expect(isServer('VultiServer-legacy')).toBe(true)
    expect(isServer('vultiserver-legacy')).toBe(true)

    expect(isServer('Serverless-device')).toBe(false)
    expect(isServer('VultiServerBackup-device')).toBe(false)
  })

  it('classifies a hybrid legacy signer list as a fast vault', () => {
    expect(hasServer(legacyFastVault.signers)).toBe(true)
  })

  it('allows legacy fast vaults through the signing-service validation gate', async () => {
    const coordinateFastSigning = vi.fn().mockResolvedValue({ signature: 'signature', format: 'ECDSA' })
    const serverManager = { coordinateFastSigning } as unknown as ServerManager
    const wasmProvider = { getWalletCore: vi.fn().mockResolvedValue({}) } as unknown as WasmProvider
    const service = new FastSigningService(serverManager, wasmProvider)

    await expect(
      service.signWithServer(
        legacyFastVault,
        { chain: Chain.Ethereum, transaction: {}, messageHashes: ['hash'] },
        'password'
      )
    ).resolves.toEqual({ signature: 'signature', format: 'ECDSA' })
    expect(coordinateFastSigning).toHaveBeenCalledOnce()
  })
})
