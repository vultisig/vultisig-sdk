import type { VaultBase } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { configureOutput, resetOutput } from '../lib/output'
import { executeJoinSecure } from './vault-management'

describe('executeJoinSecure', () => {
  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  it('forwards seedphrase path flags to sdk.joinSecureVault', async () => {
    configureOutput({ format: 'json' })

    const joinSecureVault = vi.fn(async () => ({
      vault: { name: 'Joined Vault' } as unknown as VaultBase,
      vaultId: 'vault-123',
    }))
    const ctx = {
      sdk: { joinSecureVault },
      setActiveVault: vi.fn(async () => {}),
    } as unknown as CommandContext

    const output = await import('../lib/output')
    vi.spyOn(output, 'createSpinner').mockReturnValue({
      text: '',
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    } as never)

    const ui = await import('../ui')
    vi.spyOn(ui, 'setupVaultEvents').mockImplementation(() => {})

    await executeJoinSecure(ctx, {
      qrPayload: 'vultisig://example',
      mnemonic: 'seed phrase words',
      password: 'pw',
      devices: 3,
      usePhantomSolanaPath: true,
      useCosmosPathTerra: true,
    })

    expect(joinSecureVault).toHaveBeenCalledWith(
      'vultisig://example',
      expect.objectContaining({
        mnemonic: 'seed phrase words',
        password: 'pw',
        devices: 3,
        usePhantomSolanaPath: true,
        useCosmosPathTerra: true,
      })
    )
  })
})
