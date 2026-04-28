import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { polkadotRpcUrl } from '@vultisig/core-chain/chains/polkadot/client'
import { tronRpcUrl } from '@vultisig/core-chain/chains/tron/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RawBroadcastService } from '@/vault/services/RawBroadcastService'
import { VaultError, VaultErrorCode } from '@/vault/VaultError'

const {
  mockQueryUrl,
  mockGetEvmClient,
  mockGetBlockchairBaseUrl,
  mockSendSolanaRawTx,
  mockGetCosmosClient,
  mockCosmosBroadcastTx,
  mockExecuteSuiTx,
  mockRippleRequest,
} = vi.hoisted(() => ({
  mockQueryUrl: vi.fn(),
  mockGetEvmClient: vi.fn(),
  mockGetBlockchairBaseUrl: vi.fn(),
  mockSendSolanaRawTx: vi.fn(),
  mockGetCosmosClient: vi.fn(),
  mockCosmosBroadcastTx: vi.fn(),
  mockExecuteSuiTx: vi.fn(),
  mockRippleRequest: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => mockQueryUrl(...args),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: (...args: unknown[]) => mockGetEvmClient(...args),
}))

vi.mock('@vultisig/core-chain/chains/utxo/client/getBlockchairBaseUrl', () => ({
  getBlockchairBaseUrl: (...args: unknown[]) => mockGetBlockchairBaseUrl(...args),
}))

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    sendRawTransaction: mockSendSolanaRawTx,
  }),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: (...args: unknown[]) => mockGetCosmosClient(...args),
}))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({
    executeTransactionBlock: mockExecuteSuiTx,
  }),
}))

vi.mock('@vultisig/core-chain/chains/ripple/client', () => ({
  getRippleClient: vi.fn(async () => ({
    request: mockRippleRequest,
  })),
}))

describe('RawBroadcastService', () => {
  const service = new RawBroadcastService()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlockchairBaseUrl.mockReturnValue('https://mock.blockchair.test/bitcoin')
    mockSendSolanaRawTx.mockResolvedValue('sol-signature')
    mockGetCosmosClient.mockResolvedValue({
      broadcastTx: mockCosmosBroadcastTx,
    })
    mockCosmosBroadcastTx.mockResolvedValue({ transactionHash: 'cosmos-hash' })
    mockExecuteSuiTx.mockResolvedValue({ digest: 'sui-digest' })
    mockRippleRequest.mockResolvedValue({
      result: { tx_json: { hash: 'xrp-hash' } },
    })
  })

  it('throws UnsupportedChain for chains without a raw broadcast path', async () => {
    await expect(service.broadcastRawTx({ chain: Chain.Cardano, rawTx: '00' })).rejects.toMatchObject({
      code: VaultErrorCode.UnsupportedChain,
    })
  })

  it('rethrows VaultError from inner broadcast without wrapping', async () => {
    const err = new VaultError(VaultErrorCode.BroadcastFailed, 'inner')
    mockGetEvmClient.mockReturnValue({
      sendRawTransaction: vi.fn().mockRejectedValue(err),
    })

    await expect(service.broadcastRawTx({ chain: Chain.Ethereum, rawTx: '0xabc' })).rejects.toBe(err)
  })

  it('wraps generic errors in BroadcastFailed VaultError', async () => {
    mockGetEvmClient.mockReturnValue({
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('network')),
    })

    await expect(service.broadcastRawTx({ chain: Chain.Ethereum, rawTx: '0xabc' })).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('Ethereum'),
    })
  })

  it('broadcasts UTXO txs via Blockchair push API', async () => {
    mockQueryUrl.mockResolvedValue({
      data: { transaction_hash: 'utxo-hash' },
    })

    const hash = await service.broadcastRawTx({
      chain: Chain.Bitcoin,
      rawTx: '0x010203',
    })

    expect(hash).toBe('utxo-hash')
    expect(mockGetBlockchairBaseUrl).toHaveBeenCalledWith(Chain.Bitcoin)
    expect(mockQueryUrl).toHaveBeenCalledWith(
      'https://mock.blockchair.test/bitcoin/push/transaction',
      expect.objectContaining({
        body: { data: '010203' },
      })
    )
  })

  it('maps known Blockchair duplicate-style errors to BroadcastFailed', async () => {
    mockQueryUrl.mockResolvedValue({
      data: null,
      context: { error: 'txn-mempool-conflict' },
    })

    await expect(service.broadcastRawTx({ chain: Chain.Bitcoin, rawTx: 'aa' })).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('already been submitted'),
    })
  })

  it('broadcasts Solana raw tx (base64 path)', async () => {
    const hash = await service.broadcastRawTx({
      chain: Chain.Solana,
      rawTx: 'YQ==',
    })
    expect(hash).toBe('sol-signature')
    expect(mockSendSolanaRawTx).toHaveBeenCalled()
  })

  it('broadcasts Cosmos tx when rawTx is JSON with tx_bytes', async () => {
    const txB64 = Buffer.from([1, 2, 3]).toString('base64')
    const hash = await service.broadcastRawTx({
      chain: Chain.Cosmos,
      rawTx: JSON.stringify({ tx_bytes: txB64 }),
    })
    expect(hash).toBe('cosmos-hash')
    expect(mockGetCosmosClient).toHaveBeenCalledWith(Chain.Cosmos)
    expect(mockCosmosBroadcastTx).toHaveBeenCalled()
  })

  it('broadcasts Cosmos tx when rawTx is raw base64 protobuf bytes', async () => {
    const rawB64 = Buffer.from([9, 9, 9]).toString('base64')
    await service.broadcastRawTx({
      chain: Chain.Osmosis,
      rawTx: rawB64,
    })
    expect(mockGetCosmosClient).toHaveBeenCalledWith(Chain.Osmosis)
  })

  it('rejects Sui payload missing unsignedTx or signature', async () => {
    await expect(
      service.broadcastRawTx({
        chain: Chain.Sui,
        rawTx: JSON.stringify({ unsignedTx: 'only-one-field' }),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('unsignedTx'),
    })
  })

  it('broadcasts Sui transaction from JSON payload', async () => {
    const hash = await service.broadcastRawTx({
      chain: Chain.Sui,
      rawTx: JSON.stringify({ unsignedTx: 'tx-block', signature: 'sig-bytes' }),
    })
    expect(hash).toBe('sui-digest')
    expect(mockExecuteSuiTx).toHaveBeenCalledWith({
      transactionBlock: 'tx-block',
      signature: ['sig-bytes'],
    })
  })

  it('broadcasts TON BOC via root API', async () => {
    mockQueryUrl.mockResolvedValue({ result: { hash: 'ton-hash' } })

    const hash = await service.broadcastRawTx({
      chain: Chain.Ton,
      rawTx: 'boc-base64',
    })
    expect(hash).toBe('ton-hash')
    expect(mockQueryUrl).toHaveBeenCalledWith(
      expect.stringMatching(/\/ton\/v2\/sendBocReturnHash$/),
      expect.objectContaining({ body: { boc: 'boc-base64' } })
    )
  })

  it('returns EVM transaction hash on success', async () => {
    mockGetEvmClient.mockReturnValue({
      sendRawTransaction: vi.fn().mockResolvedValue('0xevmhash'),
    })
    const hash = await service.broadcastRawTx({
      chain: Chain.Base,
      rawTx: '02f8',
    })
    expect(hash).toBe('0xevmhash')
  })

  it('broadcasts Polkadot extrinsic via JSON-RPC', async () => {
    mockQueryUrl.mockResolvedValue({ result: '0xpdhash' })

    const hash = await service.broadcastRawTx({
      chain: Chain.Polkadot,
      rawTx: '0xabc',
    })
    expect(hash).toBe('0xpdhash')
    expect(mockQueryUrl).toHaveBeenCalledWith(
      polkadotRpcUrl,
      expect.objectContaining({
        body: expect.objectContaining({
          method: 'author_submitExtrinsic',
        }),
      })
    )
  })

  it('broadcasts Bittensor extrinsic via JSON-RPC', async () => {
    mockQueryUrl.mockResolvedValue({ result: '0xbtensor' })

    const hash = await service.broadcastRawTx({
      chain: Chain.Bittensor,
      rawTx: 'beef',
    })
    expect(hash).toBe('0xbtensor')
    expect(mockQueryUrl).toHaveBeenCalledWith(
      bittensorRpcUrl,
      expect.objectContaining({
        body: expect.objectContaining({ method: 'author_submitExtrinsic' }),
      })
    )
  })

  it('broadcasts Tron transaction JSON', async () => {
    mockQueryUrl.mockResolvedValue({ txid: 'tron-id', code: 'SUCCESS' })

    const hash = await service.broadcastRawTx({
      chain: Chain.Tron,
      rawTx: JSON.stringify({ raw_data: {} }),
    })
    expect(hash).toBe('tron-id')
    expect(mockQueryUrl).toHaveBeenCalledWith(`${tronRpcUrl}/wallet/broadcasttransaction`, expect.any(Object))
  })

  it('maps Tron duplicate transaction to BroadcastFailed', async () => {
    mockQueryUrl.mockResolvedValue({
      code: 'ERROR',
      message: 'DUPLICATE_TRANSACTION',
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Tron,
        rawTx: '{}',
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('already been submitted'),
    })
  })

  it('broadcasts Ripple tx blob', async () => {
    const hash = await service.broadcastRawTx({
      chain: Chain.Ripple,
      rawTx: '0x1200aa',
    })
    expect(hash).toBe('xrp-hash')
    expect(mockRippleRequest).toHaveBeenCalledWith({
      command: 'submit',
      tx_blob: '1200aa',
    })
  })
})
