import { Chain } from '@vultisig/core-chain/Chain'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { describe, expect, it } from 'vitest'

import { resolveJoinDerivationOptions } from '../../../src/seedphrase/resolveJoinDerivationOptions'
import { buildKeygenPairingQrPayload } from '../../../src/services/buildKeygenPairingQrPayload'
import { parseKeygenQR } from '../../../src/utils/parseKeygenQR'

const pairing = {
  sessionId: 'pairing-settings',
  hexEncryptionKey: 'ab'.repeat(32),
  hexChainCode: 'cd'.repeat(32),
  localPartyId: 'sdk-initiator',
  vaultName: 'Import settings',
  libType: LibType.KEYIMPORT,
  chains: [Chain.Solana, Chain.Terra, Chain.TerraClassic],
}

describe('seedphrase pairing settings (real compression and protobuf)', () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('round trips Solana=%s and Terra=%s, preserving batching', async (usePhantomSolanaPath, useCosmosPathTerra) => {
    const options = { usePhantomSolanaPath, useCosmosPathTerra }
    const qr = await buildKeygenPairingQrPayload({ ...pairing, ...options, tssBatching: true })
    const parsed = await parseKeygenQR(qr)
    expect(parsed).toMatchObject({ ...options, chains: pairing.chains, tssBatching: true, libType: 'KEYIMPORT' })
    expect(resolveJoinDerivationOptions(parsed, {})).toEqual(options)
  })

  it('preserves legacy absence and accepts explicit legacy settings', async () => {
    const parsed = await parseKeygenQR(await buildKeygenPairingQrPayload(pairing))
    expect(parsed.usePhantomSolanaPath).toBeUndefined()
    expect(parsed.useCosmosPathTerra).toBeUndefined()
    expect(resolveJoinDerivationOptions(parsed, {})).toEqual({ usePhantomSolanaPath: false, useCosmosPathTerra: false })
    expect(resolveJoinDerivationOptions(parsed, { usePhantomSolanaPath: true, useCosmosPathTerra: true })).toEqual({
      usePhantomSolanaPath: true,
      useCosmosPathTerra: true,
    })
  })

  it.each(['usePhantomSolanaPath', 'useCosmosPathTerra'] as const)('rejects malformed or duplicate %s', async key => {
    const qr = await buildKeygenPairingQrPayload(pairing)
    for (const suffix of [`&${key}=true`, `&${key}=`, `&${key}=2`, `&${key}=0&${key}=1`, `&${key}=1&${key}=1`]) {
      await expect(parseKeygenQR(qr + suffix)).rejects.toThrow(`${key} must be a single 0 or 1`)
    }
  })

  it.each(['usePhantomSolanaPath', 'useCosmosPathTerra'] as const)('rejects contradictory explicit %s', key => {
    for (const value of [true, false]) {
      expect(() => resolveJoinDerivationOptions({ [key]: value }, { [key]: !value })).toThrow('conflicts')
      expect(resolveJoinDerivationOptions({ [key]: value }, { [key]: value })[key]).toBe(value)
    }
  })

  it('does not add import settings to fresh keygen', async () => {
    const qr = await buildKeygenPairingQrPayload({
      ...pairing,
      libType: LibType.DKLS,
      usePhantomSolanaPath: true,
      useCosmosPathTerra: true,
    })
    expect(qr).not.toContain('usePhantomSolanaPath')
    const parsed = await parseKeygenQR(qr)
    expect(parsed.libType).toBe('DKLS')
    expect(parsed.usePhantomSolanaPath).toBeUndefined()
  })
})
