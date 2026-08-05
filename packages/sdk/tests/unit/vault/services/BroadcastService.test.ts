import { Chain } from '@vultisig/core-chain/Chain'
import { broadcastAccepted, broadcastFailed } from '@vultisig/core-chain/tx/broadcast/resolver'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertNativeSwapReadyForBroadcast: vi.fn(),
  broadcastTx: vi.fn(),
  compileTx: vi.fn(),
  convertToKeysignSignatures: vi.fn(),
  decodeSigningOutput: vi.fn(),
  getEncodedSigningInputs: vi.fn(),
  getTxHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/tw/signingOutput', () => ({
  decodeSigningOutput: mocks.decodeSigningOutput,
}))
vi.mock('@vultisig/core-chain/tx/broadcast', () => ({
  broadcastTx: mocks.broadcastTx,
}))
vi.mock('@vultisig/core-chain/tx/hash', () => ({
  getTxHash: mocks.getTxHash,
}))
vi.mock('@vultisig/core-mpc/keysign/signingInputs', () => ({
  getEncodedSigningInputs: mocks.getEncodedSigningInputs,
}))
vi.mock('@vultisig/core-mpc/tx/compile/compileTx', () => ({
  compileTx: mocks.compileTx,
}))
vi.mock('@/vault/utils/convertSignature', () => ({
  convertToKeysignSignatures: mocks.convertToKeysignSignatures,
}))
vi.mock('@/vault/services/nativeSwapBroadcastGuard', () => ({
  assertNativeSwapReadyForBroadcast: mocks.assertNativeSwapReadyForBroadcast,
}))

import { BroadcastService } from '@/vault/services/BroadcastService'
import { VaultErrorCode } from '@/vault/VaultError'

describe('BroadcastService broadcast result consumption', () => {
  const signingOutput = { serialized: '{}' } as any
  const service = new BroadcastService(vi.fn().mockResolvedValue(['message-hash']), {
    getWalletCore: vi.fn().mockResolvedValue({}),
  } as any)
  const params = {
    chain: Chain.QBTC,
    keysignPayload: {} as any,
    signature: {} as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.convertToKeysignSignatures.mockReturnValue({})
    mocks.getEncodedSigningInputs.mockResolvedValue([new Uint8Array([1])])
    mocks.compileTx.mockReturnValue(new Uint8Array([2]))
    mocks.decodeSigningOutput.mockReturnValue(signingOutput)
    mocks.getTxHash.mockResolvedValue('derived-hash')
  })

  it('uses the canonical hash supplied by an accepted result', async () => {
    mocks.broadcastTx.mockResolvedValue(broadcastAccepted('provider-hash'))

    await expect(service.broadcastTx(params)).resolves.toBe('provider-hash')
    expect(mocks.getTxHash).not.toHaveBeenCalled()
  })

  it('derives a hash only when the accepted result does not provide one', async () => {
    mocks.broadcastTx.mockResolvedValue(broadcastAccepted())

    await expect(service.broadcastTx(params)).resolves.toBe('derived-hash')
    expect(mocks.getTxHash).toHaveBeenCalledWith({ chain: Chain.QBTC, tx: signingOutput })
  })

  it('maps a failed result to BroadcastFailed while retaining its original cause', async () => {
    const cause = new Error('RPC rejected the transaction')
    mocks.broadcastTx.mockResolvedValue(broadcastFailed(cause, false))

    const error = await service.broadcastTx(params).catch(value => value)

    expect(error).toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('BROADCAST_REJECTED'),
    })
    expect(error.originalError.cause).toBe(cause)
  })
})
