import { Chain } from '@vultisig/core-chain/Chain'
import { CosmosSequenceMismatchError } from '@vultisig/core-chain/tx/broadcast/cosmosSequenceMismatch'
import { broadcastAccepted, broadcastFailed } from '@vultisig/core-chain/tx/broadcast/resolver'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Signature } from '@/types'
import { formatBroadcastFailureReason } from '@/vault/services/broadcastError'
import { BroadcastPartialFailureError, BroadcastService } from '@/vault/services/BroadcastService'
import { VaultErrorCode } from '@/vault/VaultError'

const {
  mockGetCoinType,
  mockGetTwPublicKeyType,
  mockDecodeSigningOutput,
  mockCoreBroadcastTx,
  mockGetTxHash,
  mockGetTxStatus,
  mockGetEncodedSigningInputs,
  mockAssertNativeSwapReadyForBroadcast,
  mockGetKeysignTwPublicKey,
  mockCompileTx,
  mockConvertToKeysignSignatures,
} = vi.hoisted(() => ({
  mockGetCoinType: vi.fn(),
  mockGetTwPublicKeyType: vi.fn(),
  mockDecodeSigningOutput: vi.fn(),
  mockCoreBroadcastTx: vi.fn(),
  mockGetTxHash: vi.fn(),
  mockGetTxStatus: vi.fn(),
  mockGetEncodedSigningInputs: vi.fn(),
  mockAssertNativeSwapReadyForBroadcast: vi.fn(),
  mockGetKeysignTwPublicKey: vi.fn(),
  mockCompileTx: vi.fn(),
  mockConvertToKeysignSignatures: vi.fn(),
}))

vi.mock('@vultisig/core-chain/coin/coinType', () => ({
  getCoinType: (...args: unknown[]) => mockGetCoinType(...args),
}))

vi.mock('@vultisig/core-chain/publicKey/tw/getTwPublicKeyType', () => ({
  getTwPublicKeyType: (...args: unknown[]) => mockGetTwPublicKeyType(...args),
}))

vi.mock('@vultisig/core-chain/tw/signingOutput', () => ({
  decodeSigningOutput: (...args: unknown[]) => mockDecodeSigningOutput(...args),
}))

vi.mock('@vultisig/core-chain/tx/broadcast', () => ({
  broadcastTx: (...args: unknown[]) => mockCoreBroadcastTx(...args),
}))

vi.mock('@vultisig/core-chain/tx/hash', () => ({
  getTxHash: (...args: unknown[]) => mockGetTxHash(...args),
}))

vi.mock('@vultisig/core-chain/tx/status', () => ({
  getTxStatus: (...args: unknown[]) => mockGetTxStatus(...args),
}))

vi.mock('@vultisig/core-mpc/keysign/signingInputs', () => ({
  getEncodedSigningInputs: (...args: unknown[]) => mockGetEncodedSigningInputs(...args),
}))

vi.mock('@vultisig/core-mpc/keysign/swap/assertNativeSwapReadyForBroadcast', () => ({
  assertNativeSwapReadyForBroadcast: (...args: unknown[]) => mockAssertNativeSwapReadyForBroadcast(...args),
}))

vi.mock('@vultisig/core-mpc/keysign/tw/getKeysignTwPublicKey', () => ({
  getKeysignTwPublicKey: (...args: unknown[]) => mockGetKeysignTwPublicKey(...args),
}))

vi.mock('@vultisig/core-mpc/tx/compile/compileTx', () => ({
  compileTx: (...args: unknown[]) => mockCompileTx(...args),
}))

vi.mock('@/vault/utils/convertSignature', () => ({
  convertToKeysignSignatures: (...args: unknown[]) => mockConvertToKeysignSignatures(...args),
}))

const fakeWalletCore = {
  CoinType: { tron: 'coin-tron' },
  PublicKeyType: { secp256k1Extended: 'pubkey-secp256k1-extended' },
  PublicKey: { createWithData: vi.fn().mockReturnValue('fake-public-key') },
}

const signature: Signature = { signature: '0xdeadbeef', format: 'ECDSA' }
const keysignPayload = {} as KeysignPayload

describe('BroadcastService', () => {
  const wasmProvider = {
    getWalletCore: vi.fn().mockResolvedValue(fakeWalletCore),
  }
  const extractMessageHashes = vi.fn().mockResolvedValue(['0xmessagehash'])
  const service = new BroadcastService(extractMessageHashes, wasmProvider)

  beforeEach(() => {
    vi.clearAllMocks()
    wasmProvider.getWalletCore.mockResolvedValue(fakeWalletCore)
    extractMessageHashes.mockResolvedValue(['0xmessagehash'])
    mockAssertNativeSwapReadyForBroadcast.mockResolvedValue(undefined)
    mockGetKeysignTwPublicKey.mockReturnValue(new Uint8Array())
    mockGetTwPublicKeyType.mockReturnValue('pubkey-type')
    mockGetCoinType.mockReturnValue('coin-not-tron')
    mockConvertToKeysignSignatures.mockReturnValue({})
    mockCompileTx.mockReturnValue('compiled-tx-bytes')
    mockDecodeSigningOutput.mockReturnValue({ marker: 'signing-output' })
    mockGetEncodedSigningInputs.mockResolvedValue(['tx-input'])
    mockGetTxStatus.mockResolvedValue({ status: 'success' })
  })

  it('falls back to the locally computed hash when the accepted result has no hash', async () => {
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted())
    mockGetTxHash.mockResolvedValue('0xlocally-computed-hash')

    const hash = await service.broadcastTx({
      chain: Chain.Ethereum,
      keysignPayload,
      signature,
    })

    expect(hash).toBe('0xlocally-computed-hash')
    expect(mockGetTxHash).toHaveBeenCalledOnce()
  })

  it('prefers the canonical hash from the accepted result over local computation', async () => {
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted('node-returned-hash'))
    mockGetTxHash.mockResolvedValue('should-never-be-used')

    const hash = await service.broadcastTx({
      chain: Chain.Bitcoin,
      keysignPayload,
      signature,
    })

    expect(hash).toBe('node-returned-hash')
    expect(mockGetTxHash).not.toHaveBeenCalled()
  })

  it('uses the normalized canonical Tron hash', async () => {
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted('tron-node-hash'))
    mockGetTxHash.mockResolvedValue('should-never-be-used')

    const hash = await service.broadcastTx({
      chain: Chain.Tron,
      keysignPayload,
      signature,
    })

    expect(hash).toBe('tron-node-hash')
    expect(mockGetTxHash).not.toHaveBeenCalled()
  })

  it('falls back to the local hash when the accepted result omits a hash', async () => {
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted())
    mockGetTxHash.mockResolvedValue('local-fallback-hash')

    const hash = await service.broadcastTx({
      chain: Chain.Bitcoin,
      keysignPayload,
      signature,
    })

    expect(hash).toBe('local-fallback-hash')
  })

  it('falls back to the local hash when accepted provider details contain no canonical hash', async () => {
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted(undefined, { provider: { result: true } }))
    mockGetTxHash.mockResolvedValue('local-fallback-hash')

    const hash = await service.broadcastTx({
      chain: Chain.Tron,
      keysignPayload,
      signature,
    })

    expect(hash).toBe('local-fallback-hash')
  })

  it('resolves each broadcast input independently and returns the last transaction hash (approve + swap)', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['approve-input', 'swap-input'])
    mockCoreBroadcastTx
      .mockResolvedValueOnce(broadcastAccepted())
      .mockResolvedValueOnce(broadcastAccepted('swap-node-hash'))
    mockGetTxHash.mockResolvedValue('approve-local-hash')

    const hash = await service.broadcastTx({
      chain: Chain.Ethereum,
      keysignPayload,
      signature,
    })

    expect(hash).toBe('swap-node-hash')
    // Only the first hashless accepted result needed the local fallback.
    expect(mockGetTxHash).toHaveBeenCalledOnce()
  })

  it('uses an injected broadcaster without calling the network broadcaster', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['approve-input', 'swap-input'])
    mockGetTxHash.mockResolvedValueOnce('approve-local-hash').mockResolvedValueOnce('swap-local-hash')
    const injectedBroadcaster = vi.fn().mockResolvedValue(broadcastAccepted())
    const injectedService = new BroadcastService(extractMessageHashes, wasmProvider, injectedBroadcaster)

    await injectedService.broadcastTx({ chain: Chain.Ethereum, keysignPayload, signature })

    expect(injectedBroadcaster).toHaveBeenCalledTimes(2)
    expect(mockCoreBroadcastTx).not.toHaveBeenCalled()
  })

  it('carries already-broadcast hashes when a later input fails', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['approve-input', 'swap-input'])
    mockCoreBroadcastTx.mockResolvedValueOnce(broadcastAccepted()).mockRejectedValueOnce(new Error('swap rejected'))
    mockGetTxHash.mockResolvedValueOnce('approve-local-hash')

    const promise = service.broadcastTx({ chain: Chain.Ethereum, keysignPayload, signature })

    await expect(promise).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      originalError: expect.objectContaining({
        broadcastedTxHashes: ['approve-local-hash'],
        failedInputIndex: 1,
      }),
    })
    await expect(promise).rejects.toHaveProperty('originalError', expect.any(BroadcastPartialFailureError))
  })

  it('wraps a broadcast failure in a BroadcastFailed VaultError', async () => {
    mockCoreBroadcastTx.mockRejectedValue(new Error('network down'))

    await expect(service.broadcastTx({ chain: Chain.Ethereum, keysignPayload, signature })).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('Ethereum'),
    })
  })

  it('maps a failed broadcast result while retaining its original cause', async () => {
    const cause = new Error('RPC rejected the transaction')
    mockCoreBroadcastTx.mockResolvedValue(broadcastFailed(cause, false))

    const error = await service.broadcastTx({ chain: Chain.Ethereum, keysignPayload, signature }).catch(value => value)

    expect(error).toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('BROADCAST_REJECTED'),
    })
    expect(error.originalError.cause).toBe(cause)
  })

  it('keeps the RPC rejection reason but removes the signed raw transaction from the public error', async () => {
    const signedRawTx = `0x${'ab'.repeat(256)}`
    const cause = Object.assign(new Error(`RPC request failed. Request body: ${signedRawTx}`), {
      details: 'transaction gas price below minimum: gas tip cap 0, minimum needed 25000000000',
    })
    mockCoreBroadcastTx.mockResolvedValue(broadcastFailed(cause, false))

    const error = await service.broadcastTx({ chain: Chain.Polygon, keysignPayload, signature }).catch(value => value)

    expect(error).toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('gas tip cap 0, minimum needed 25000000000'),
    })
    expect(error.message).not.toContain(signedRawTx)
    expect(error.toJSON().originalError).not.toContain(signedRawTx)
  })

  it('waits for ERC-20 approval confirmation before broadcasting the swap input', async () => {
    const events: string[] = []
    mockGetEncodedSigningInputs.mockResolvedValue(['approval-input', 'swap-input'])
    mockCompileTx.mockImplementation(({ txInputData }) => txInputData)
    mockDecodeSigningOutput.mockImplementation((_chain, tx) => tx)
    const injectedBroadcaster = vi.fn(async () => {
      events.push('broadcast')
      return broadcastAccepted()
    })
    mockGetTxHash.mockImplementation(async ({ tx }) => (tx.includes('approval-input') ? '0xapproval' : '0xswap'))
    mockGetTxStatus.mockImplementation(async ({ hash }) => {
      events.push(`status:${hash}`)
      return { status: 'success' }
    })

    const approvalService = new BroadcastService(extractMessageHashes, wasmProvider, injectedBroadcaster, {
      approvalConfirmationIntervalMs: 1,
      approvalConfirmationTimeoutMs: 100,
    })

    const txHash = await approvalService.broadcastTx({
      chain: Chain.Ethereum,
      keysignPayload: { erc20ApprovePayload: {} } as KeysignPayload,
      signature,
    })

    expect(txHash).toBe('0xswap')
    expect(events).toEqual(['broadcast', 'status:0xapproval', 'broadcast'])
    expect(injectedBroadcaster).toHaveBeenCalledTimes(2)
    expect(mockCoreBroadcastTx).not.toHaveBeenCalled()
    expect(mockGetTxStatus).toHaveBeenCalledWith({
      chain: Chain.Ethereum,
      hash: '0xapproval',
    })
  })

  it('does not broadcast the swap input when the approval transaction fails', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['approval-input', 'swap-input'])
    mockCompileTx.mockImplementation(({ txInputData }) => txInputData)
    mockDecodeSigningOutput.mockImplementation((_chain, tx) => tx)
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted())
    mockGetTxHash.mockImplementation(async ({ tx }) => (tx.includes('approval-input') ? '0xapproval' : '0xswap'))
    mockGetTxStatus.mockResolvedValue({ status: 'error' })

    const approvalService = new BroadcastService(extractMessageHashes, wasmProvider, {
      approvalConfirmationIntervalMs: 1,
      approvalConfirmationTimeoutMs: 100,
    })

    await expect(
      approvalService.broadcastTx({
        chain: Chain.Ethereum,
        keysignPayload: { erc20ApprovePayload: {} } as KeysignPayload,
        signature,
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('Approval tx failed'),
      originalError: expect.objectContaining({
        broadcastedTxHashes: ['0xapproval'],
        failedInputIndex: 0,
      }),
    })

    expect(mockCoreBroadcastTx).toHaveBeenCalledOnce()
  })

  it('does not broadcast the swap input when approval confirmation times out', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['approval-input', 'swap-input'])
    mockCompileTx.mockImplementation(({ txInputData }) => txInputData)
    mockDecodeSigningOutput.mockImplementation((_chain, tx) => tx)
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted())
    mockGetTxHash.mockImplementation(async ({ tx }) => (tx.includes('approval-input') ? '0xapproval' : '0xswap'))
    mockGetTxStatus.mockResolvedValue({ status: 'pending' })

    const approvalService = new BroadcastService(extractMessageHashes, wasmProvider, {
      approvalConfirmationIntervalMs: 1,
      approvalConfirmationTimeoutMs: 0,
    })

    await expect(
      approvalService.broadcastTx({
        chain: Chain.Ethereum,
        keysignPayload: { erc20ApprovePayload: {} } as KeysignPayload,
        signature,
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('Approval tx not confirmed within 0s'),
      originalError: expect.objectContaining({
        broadcastedTxHashes: ['0xapproval'],
        failedInputIndex: 0,
      }),
    })

    expect(mockCoreBroadcastTx).toHaveBeenCalledOnce()
  })

  it('bounds a never-resolving approval status request by the confirmation deadline', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['approval-input', 'swap-input'])
    mockCompileTx.mockImplementation(({ txInputData }) => txInputData)
    mockDecodeSigningOutput.mockImplementation((_chain, tx) => tx)
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted())
    mockGetTxHash.mockResolvedValue('0xapproval')
    mockGetTxStatus.mockReturnValue(new Promise(() => {}))

    const approvalService = new BroadcastService(extractMessageHashes, wasmProvider, {
      approvalConfirmationIntervalMs: 1,
      approvalConfirmationTimeoutMs: 20,
    })

    await expect(
      approvalService.broadcastTx({
        chain: Chain.Ethereum,
        keysignPayload: { erc20ApprovePayload: {} } as KeysignPayload,
        signature,
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('Approval tx not confirmed within 0.02s'),
      originalError: expect.objectContaining({
        broadcastedTxHashes: ['0xapproval'],
        failedInputIndex: 0,
      }),
    })

    expect(mockGetTxStatus).toHaveBeenCalledOnce()
    expect(mockCoreBroadcastTx).toHaveBeenCalledOnce()
  })

  it('does not wait between multiple inputs without an ERC-20 approval payload', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['first-input', 'second-input'])
    mockCoreBroadcastTx.mockResolvedValue(broadcastAccepted())
    mockGetTxHash.mockResolvedValueOnce('0xfirst').mockResolvedValueOnce('0xsecond')

    await service.broadcastTx({
      chain: Chain.Ethereum,
      keysignPayload,
      signature,
    })

    expect(mockCoreBroadcastTx).toHaveBeenCalledTimes(2)
    expect(mockGetTxStatus).not.toHaveBeenCalled()
  })

  it('preserves typed Cosmos stale-sequence recovery through the public broadcast error', async () => {
    const mismatch = new CosmosSequenceMismatchError({
      expectedSequence: 255n,
      signedSequence: 254n,
    })
    mockCoreBroadcastTx.mockResolvedValue(broadcastFailed(mismatch, false))

    await expect(service.broadcastTx({ chain: Chain.Cosmos, keysignPayload, signature })).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('start a new signing ceremony'),
      originalError: expect.objectContaining({ cause: mismatch }),
    })
  })
})

describe('formatBroadcastFailureReason', () => {
  it('redacts a long signed payload when no structured RPC detail is available', () => {
    const signedRawTx = `0x${'cd'.repeat(256)}`

    expect(formatBroadcastFailureReason(new Error(`transaction rejected; raw=${signedRawTx}`))).toBe(
      'transaction rejected; raw=[signed transaction redacted]'
    )
  })
})
