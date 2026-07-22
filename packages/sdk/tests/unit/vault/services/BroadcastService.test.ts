import { Chain } from '@vultisig/core-chain/Chain'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Signature } from '@/types'
import { BroadcastService } from '@/vault/services/BroadcastService'
import { VaultErrorCode } from '@/vault/VaultError'

const {
  mockGetCoinType,
  mockGetTwPublicKeyType,
  mockDecodeSigningOutput,
  mockCoreBroadcastTx,
  mockGetTxHash,
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
  const wasmProvider = { getWalletCore: vi.fn().mockResolvedValue(fakeWalletCore) }
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
  })

  it('falls back to the locally computed hash when the resolver returns void (evm/cosmos/sui/ripple/ton/polkadot/bittensor)', async () => {
    mockCoreBroadcastTx.mockResolvedValue(undefined)
    mockGetTxHash.mockResolvedValue('0xlocally-computed-hash')

    const hash = await service.broadcastTx({ chain: Chain.Ethereum, keysignPayload, signature })

    expect(hash).toBe('0xlocally-computed-hash')
    expect(mockGetTxHash).toHaveBeenCalledOnce()
  })

  it('prefers the resolver-returned hash over the local computation when the resolver returns a bare string (utxo/cardano)', async () => {
    mockCoreBroadcastTx.mockResolvedValue('node-returned-hash')
    mockGetTxHash.mockResolvedValue('should-never-be-used')

    const hash = await service.broadcastTx({ chain: Chain.Bitcoin, keysignPayload, signature })

    expect(hash).toBe('node-returned-hash')
    expect(mockGetTxHash).not.toHaveBeenCalled()
  })

  it('prefers the resolver-returned txid over the local computation for the Tron response shape', async () => {
    mockCoreBroadcastTx.mockResolvedValue({ txid: 'tron-node-hash', result: true })
    mockGetTxHash.mockResolvedValue('should-never-be-used')

    const hash = await service.broadcastTx({ chain: Chain.Tron, keysignPayload, signature })

    expect(hash).toBe('tron-node-hash')
    expect(mockGetTxHash).not.toHaveBeenCalled()
  })

  it('falls back to the local hash when the resolver returns an empty string', async () => {
    mockCoreBroadcastTx.mockResolvedValue('')
    mockGetTxHash.mockResolvedValue('local-fallback-hash')

    const hash = await service.broadcastTx({ chain: Chain.Bitcoin, keysignPayload, signature })

    expect(hash).toBe('local-fallback-hash')
  })

  it('falls back to the local hash when the resolver returns an object without a usable txid', async () => {
    mockCoreBroadcastTx.mockResolvedValue({ result: true })
    mockGetTxHash.mockResolvedValue('local-fallback-hash')

    const hash = await service.broadcastTx({ chain: Chain.Tron, keysignPayload, signature })

    expect(hash).toBe('local-fallback-hash')
  })

  it('resolves each broadcast input independently and returns the last transaction hash (approve + swap)', async () => {
    mockGetEncodedSigningInputs.mockResolvedValue(['approve-input', 'swap-input'])
    mockCoreBroadcastTx.mockResolvedValueOnce(undefined).mockResolvedValueOnce('swap-node-hash')
    mockGetTxHash.mockResolvedValue('approve-local-hash')

    const hash = await service.broadcastTx({ chain: Chain.Ethereum, keysignPayload, signature })

    expect(hash).toBe('swap-node-hash')
    // Only the first (void-resolver) iteration needed the local fallback.
    expect(mockGetTxHash).toHaveBeenCalledOnce()
  })

  it('wraps a broadcast failure in a BroadcastFailed VaultError', async () => {
    mockCoreBroadcastTx.mockRejectedValue(new Error('network down'))

    await expect(service.broadcastTx({ chain: Chain.Ethereum, keysignPayload, signature })).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('Ethereum'),
    })
  })
})
