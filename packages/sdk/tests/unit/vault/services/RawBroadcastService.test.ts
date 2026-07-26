import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { polkadotRpcUrl } from '@vultisig/core-chain/chains/polkadot/client'
import { tronRpcUrl } from '@vultisig/core-chain/chains/tron/config'
import base58 from 'bs58'
import { encode as xrplEncode } from 'ripple-binary-codec'
import { keccak256 } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashes as xrplHashes } from 'xrpl'

import { RawBroadcastService } from '@/vault/services/RawBroadcastService'
import { VaultError, VaultErrorCode } from '@/vault/VaultError'

const makeRippleRawTx = () =>
  xrplEncode({
    TransactionType: 'Payment',
    Account: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    Destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
    Amount: '1',
    Fee: '10',
    Sequence: 1,
    SigningPubKey: '',
    TxnSignature: '',
  })

const {
  mockQueryUrl,
  mockGetEvmClient,
  mockGetBlockchairBaseUrl,
  mockSendSolanaRawTx,
  mockGetSolanaSignatureStatuses,
  mockGetCosmosClient,
  mockCosmosBroadcastTx,
  mockCosmosGetTx,
  mockExecuteSuiTx,
  mockRippleRequest,
} = vi.hoisted(() => ({
  mockQueryUrl: vi.fn(),
  mockGetEvmClient: vi.fn(),
  mockGetBlockchairBaseUrl: vi.fn(),
  mockSendSolanaRawTx: vi.fn(),
  mockGetSolanaSignatureStatuses: vi.fn(),
  mockGetCosmosClient: vi.fn(),
  mockCosmosBroadcastTx: vi.fn(),
  mockCosmosGetTx: vi.fn(),
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
    getSignatureStatuses: mockGetSolanaSignatureStatuses,
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
    mockGetSolanaSignatureStatuses.mockResolvedValue({ value: [null] })
    mockGetCosmosClient.mockResolvedValue({
      broadcastTx: mockCosmosBroadcastTx,
      getTx: mockCosmosGetTx,
    })
    mockCosmosBroadcastTx.mockResolvedValue({ transactionHash: 'cosmos-hash', code: 0 })
    mockCosmosGetTx.mockResolvedValue(null)
    mockExecuteSuiTx.mockResolvedValue({
      digest: 'sui-digest',
      effects: { status: { status: 'success' } },
    })
    mockRippleRequest.mockResolvedValue({
      result: {
        engine_result: 'tesSUCCESS',
        engine_result_code: 0,
        tx_json: { hash: 'xrp-hash' },
      },
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

  // sendRawTransaction is fire-and-forget (accepted-into-queue, not execution result), so the
  // raw path cannot assert success from the send response the way Cosmos/Sui do. This bounded
  // status check catches the case where the node already knows the signature failed on-chain.
  it('throws instead of returning a signature when Solana reports an on-chain error for it', async () => {
    mockGetSolanaSignatureStatuses.mockResolvedValue({
      value: [{ err: { InstructionError: [0, 'Custom'] } }],
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Solana,
        rawTx: 'YQ==',
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('failed on-chain'),
    })
  })

  it('still returns the signature when the status check finds no record yet (normal, not yet confirmed)', async () => {
    mockGetSolanaSignatureStatuses.mockResolvedValue({ value: [null] })

    const hash = await service.broadcastRawTx({
      chain: Chain.Solana,
      rawTx: 'YQ==',
    })
    expect(hash).toBe('sol-signature')
  })

  it('still returns the signature when the status check itself errors (verification is best-effort, not a new failure mode)', async () => {
    mockGetSolanaSignatureStatuses.mockRejectedValue(new Error('rpc down'))

    const hash = await service.broadcastRawTx({
      chain: Chain.Solana,
      rawTx: 'YQ==',
    })
    expect(hash).toBe('sol-signature')
  })

  it('treats duplicate-style Solana broadcast errors as idempotent success', async () => {
    const signature = Uint8Array.from({ length: 64 }, (_, index) => index + 1)
    const rawTx = Buffer.from(Uint8Array.from([1, ...signature, 0])).toString('base64')
    mockSendSolanaRawTx.mockRejectedValue(new Error('AlreadyProcessed'))
    mockGetSolanaSignatureStatuses.mockResolvedValue({ value: [{ err: null }] })

    const hash = await service.broadcastRawTx({
      chain: Chain.Solana,
      rawTx,
    })

    expect(hash).toBe(base58.encode(signature))
  })

  // Fund-safety: "AlreadyProcessed" only proves the node executed this signature before, not
  // that the execution succeeded. The idempotent-retry path must run through the same
  // on-chain-failure status check as a fresh send, not report success unconditionally.
  it('fails closed on a duplicate-style Solana broadcast error when the signature already failed on-chain', async () => {
    const signature = Uint8Array.from({ length: 64 }, (_, index) => index + 1)
    const rawTx = Buffer.from(Uint8Array.from([1, ...signature, 0])).toString('base64')
    mockSendSolanaRawTx.mockRejectedValue(new Error('AlreadyProcessed'))
    mockGetSolanaSignatureStatuses.mockResolvedValue({
      value: [{ err: { InstructionError: [0, 'Custom'] } }],
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Solana,
        rawTx,
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('failed on-chain'),
    })
  })

  it.each([
    {
      name: 'the status lookup finds no record',
      arrange: () => mockGetSolanaSignatureStatuses.mockResolvedValue({ value: [null] }),
    },
    {
      name: 'the status lookup errors',
      arrange: () => mockGetSolanaSignatureStatuses.mockRejectedValue(new Error('rpc down')),
    },
  ])('fails closed on a duplicate-style Solana broadcast error when $name', async ({ arrange }) => {
    const signature = Uint8Array.from({ length: 64 }, (_, index) => index + 1)
    const rawTx = Buffer.from(Uint8Array.from([1, ...signature, 0])).toString('base64')
    mockSendSolanaRawTx.mockRejectedValue(new Error('AlreadyProcessed'))
    arrange()

    await expect(
      service.broadcastRawTx({
        chain: Chain.Solana,
        rawTx,
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('could not be verified'),
    })
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

  // Fund-safety: StargateClient.broadcastTx RESOLVES (does not throw) on a tx that was included but
  // failed execution (DeliverTx code !== 0). The raw path must not report that as a success hash.
  it('throws instead of returning a hash when the Cosmos tx is included but DeliverTx-fails', async () => {
    mockCosmosBroadcastTx.mockResolvedValueOnce({
      transactionHash: 'reverted-hash',
      code: 5,
      height: 100,
      rawLog: 'out of gas: gasWanted: 200000, gasUsed: 250000',
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Cosmos,
        rawTx: JSON.stringify({ tx_bytes: Buffer.from([1, 2, 3]).toString('base64') }),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('execution failed'),
    })
  })

  it('treats duplicate-style Cosmos broadcast errors as idempotent success', async () => {
    const txBytes = Buffer.from([1, 2, 3])
    const rawTx = txBytes.toString('base64')
    mockCosmosBroadcastTx.mockRejectedValue(new Error('tx already exists in cache'))
    mockCosmosGetTx.mockResolvedValue({
      hash: bytesToHex(sha256(txBytes)).toUpperCase(),
      code: 0,
    })

    const hash = await service.broadcastRawTx({
      chain: Chain.Cosmos,
      rawTx,
    })

    expect(hash).toBe(bytesToHex(sha256(txBytes)).toUpperCase())
  })

  it('fails closed when a duplicate Cosmos transaction already failed execution', async () => {
    mockCosmosBroadcastTx.mockRejectedValue(new Error('tx already exists in cache'))
    mockCosmosGetTx.mockResolvedValue({
      hash: 'failed-hash',
      code: 5,
      rawLog: 'out of gas',
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Cosmos,
        rawTx: Buffer.from([1, 2, 3]).toString('base64'),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('execution failed'),
    })
  })

  it('fails closed when a duplicate Cosmos transaction cannot be verified on-chain', async () => {
    mockCosmosBroadcastTx.mockRejectedValue(new Error('tx already exists in cache'))
    mockCosmosGetTx.mockResolvedValue(null)

    await expect(
      service.broadcastRawTx({
        chain: Chain.Cosmos,
        rawTx: Buffer.from([1, 2, 3]).toString('base64'),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('could not be verified'),
    })
  })

  it('fails closed on an ambiguous Cosmos account sequence mismatch', async () => {
    mockCosmosBroadcastTx.mockRejectedValue(new Error('account sequence mismatch'))

    await expect(
      service.broadcastRawTx({
        chain: Chain.Cosmos,
        rawTx: Buffer.from([1, 2, 3]).toString('base64'),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('account sequence mismatch'),
    })
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
      options: { showEffects: true },
    })
  })

  it('rejects finalized Sui transactions with failed execution effects', async () => {
    mockExecuteSuiTx.mockResolvedValue({
      digest: 'sui-digest',
      effects: { status: { status: 'failure', error: 'MoveAbort(42)' } },
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Sui,
        rawTx: JSON.stringify({
          unsignedTx: 'tx-block',
          signature: 'sig-bytes',
        }),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('Sui transaction failed on-chain: MoveAbort(42)'),
    })
  })

  it.each([{ digest: 'sui-digest' }, { digest: 'sui-digest', effects: { status: {} } }])(
    'rejects Sui responses without explicit successful execution effects',
    async response => {
      mockExecuteSuiTx.mockResolvedValue(response)

      await expect(
        service.broadcastRawTx({
          chain: Chain.Sui,
          rawTx: JSON.stringify({
            unsignedTx: 'tx-block',
            signature: 'sig-bytes',
          }),
        })
      ).rejects.toMatchObject({
        code: VaultErrorCode.BroadcastFailed,
        message: expect.stringContaining('no effects status returned'),
      })
    }
  )

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

  it('treats duplicate-style EVM broadcast errors as idempotent success', async () => {
    mockGetEvmClient.mockReturnValue({
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('already known')),
    })

    const rawTx = '0x01'
    const hash = await service.broadcastRawTx({
      chain: Chain.Base,
      rawTx,
    })

    expect(hash).toBe(keccak256(rawTx))
  })

  it.each([
    'nonce too low',
    'transaction is temporarily banned',
    'future transaction tries to replace pending',
    'could not replace existing tx',
  ])('fails closed on ambiguous EVM rejection: %s', async errorMessage => {
    mockGetEvmClient.mockReturnValue({
      sendRawTransaction: vi.fn().mockRejectedValue(new Error(errorMessage)),
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Base,
        rawTx: '0x01',
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining(errorMessage),
    })
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

  // JSON-RPC 2.0 requires exactly one of `result` / `error`. A malformed gateway response with
  // NEITHER must not fall through to `return response.result` and hand back `undefined` as a hash.
  it('throws on a malformed Polkadot response with neither result nor error', async () => {
    mockQueryUrl.mockResolvedValue({})

    await expect(
      service.broadcastRawTx({
        chain: Chain.Polkadot,
        rawTx: '0xabc',
      })
    ).rejects.toThrow(/missing extrinsic hash/)
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

  it('throws on a malformed Bittensor response with neither result nor error', async () => {
    mockQueryUrl.mockResolvedValue({})

    await expect(
      service.broadcastRawTx({
        chain: Chain.Bittensor,
        rawTx: 'beef',
      })
    ).rejects.toThrow(/missing extrinsic hash/)
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
      code: 'DUP_TRANSACTION_ERROR',
      message: Buffer.from('Transaction already exists').toString('hex'),
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

  // `result: false` is Tron's own explicit failure signal, independent of `code`. Only checking
  // `code !== 'SUCCESS'` misses a response that carries `result: false` without a `code` at all -
  // that must not fall through to the txid check and be reported as a success.
  it('throws on a Tron response with result:false and no code', async () => {
    mockQueryUrl.mockResolvedValue({ result: false, txid: 'tron-id' })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Tron,
        rawTx: '{}',
      })
    ).rejects.toThrow(/Tron broadcast failed/)
  })

  it('returns the derived Tron txID for duplicate transaction responses', async () => {
    const rawDataHex =
      '0a02f69b22087d4a3b02495f232040b888e6eaa5335a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a15411320a6fb4dcd4ff8e91392a8cb98378633cf7dd81215414c8967080d86f3d0e1352a42f9213c7b9dd03b0f18c0843d7080cae2eaa533'
    const expectedHash = '6db783c4142b3749a4b598db4644155455c9206e2eca4b31efbd48e46773d9d5'
    mockQueryUrl
      .mockResolvedValueOnce({
        code: 'DUP_TRANSACTION_ERROR',
        message: Buffer.from('Transaction already exists').toString('hex'),
      })
      .mockResolvedValueOnce({
        id: expectedHash,
        blockNumber: 12345,
        receipt: { result: 'SUCCESS' },
      })

    const hash = await service.broadcastRawTx({
      chain: Chain.Tron,
      rawTx: JSON.stringify({
        txID: expectedHash.toUpperCase(),
        raw_data_hex: rawDataHex,
      }),
    })

    expect(hash).toBe(expectedHash)
    expect(bytesToHex(sha256(Buffer.from(rawDataHex, 'hex')))).toBe(expectedHash)
  })

  it('fails closed when a duplicate Tron response carries a mismatched txID', async () => {
    mockQueryUrl.mockResolvedValue({
      code: 'DUP_TRANSACTION_ERROR',
      message: Buffer.from('Transaction already exists').toString('hex'),
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Tron,
        rawTx: JSON.stringify({
          txID: '00'.repeat(32),
          raw_data_hex: '010203',
        }),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('already been submitted'),
    })
  })

  it('fails closed when a duplicate Tron response is only an unverified RPC cache hit', async () => {
    const rawDataHex = '010203'
    const expectedHash = bytesToHex(sha256(Buffer.from(rawDataHex, 'hex')))
    mockQueryUrl
      .mockResolvedValueOnce({
        code: 'DUP_TRANSACTION_ERROR',
        message: Buffer.from('Transaction already exists').toString('hex'),
      })
      .mockResolvedValueOnce({})

    await expect(
      service.broadcastRawTx({
        chain: Chain.Tron,
        rawTx: JSON.stringify({
          txID: expectedHash,
          raw_data_hex: rawDataHex,
        }),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('could not be verified'),
    })
  })

  it('fails closed when a duplicate Tron transaction already failed on-chain', async () => {
    const rawDataHex = '010203'
    const expectedHash = bytesToHex(sha256(Buffer.from(rawDataHex, 'hex')))
    mockQueryUrl
      .mockResolvedValueOnce({
        code: 'DUP_TRANSACTION_ERROR',
        message: Buffer.from('Transaction already exists').toString('hex'),
      })
      .mockResolvedValueOnce({
        id: expectedHash,
        blockNumber: 12345,
        receipt: { result: 'REVERT' },
      })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Tron,
        rawTx: JSON.stringify({
          txID: expectedHash,
          raw_data_hex: rawDataHex,
        }),
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('failed on-chain'),
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

  it('treats duplicate-style Ripple broadcast errors as idempotent success', async () => {
    const rawTx = makeRippleRawTx()
    mockRippleRequest
      .mockResolvedValueOnce({
        result: {
          engine_result: 'tefALREADY',
          engine_result_code: -198,
          engine_result_message: 'The transaction was already applied.',
        },
      })
      .mockResolvedValueOnce({
        result: {
          validated: true,
          meta: { TransactionResult: 'tesSUCCESS' },
        },
      })

    const hash = await service.broadcastRawTx({
      chain: Chain.Ripple,
      rawTx,
    })

    expect(hash).toBe(xrplHashes.hashSignedTx(rawTx))
  })

  it('fails closed when a duplicate Ripple transaction finalized with a tec failure', async () => {
    const rawTx = makeRippleRawTx()
    mockRippleRequest
      .mockResolvedValueOnce({
        result: {
          engine_result: 'tefALREADY',
          engine_result_code: -198,
          engine_result_message: 'The transaction was already applied.',
        },
      })
      .mockResolvedValueOnce({
        result: {
          validated: true,
          meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' },
        },
      })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Ripple,
        rawTx,
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('failed on-chain'),
    })
  })

  it('fails closed when a duplicate Ripple transaction cannot be found by hash', async () => {
    const rawTx = makeRippleRawTx()
    mockRippleRequest
      .mockResolvedValueOnce({
        result: {
          engine_result: 'tefALREADY',
          engine_result_code: -198,
          engine_result_message: 'The transaction was already applied.',
        },
      })
      .mockRejectedValueOnce(new Error('txnNotFound'))

    await expect(
      service.broadcastRawTx({
        chain: Chain.Ripple,
        rawTx,
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('could not be verified'),
    })
  })

  it('fails closed on an ambiguous Ripple past-sequence response', async () => {
    mockRippleRequest.mockResolvedValue({
      result: {
        engine_result: 'tefPAST_SEQ',
        engine_result_code: -190,
        engine_result_message: 'This sequence number has already passed.',
        tx_json: { hash: 'misleading-hash' },
      },
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Ripple,
        rawTx: '1200aa',
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('tefPAST_SEQ'),
    })
  })

  it('fails closed on an ambiguous Ripple response even when it includes a transaction hash', async () => {
    mockRippleRequest.mockResolvedValue({
      result: {
        tx_json: { hash: 'misleading-hash' },
      },
    })

    await expect(
      service.broadcastRawTx({
        chain: Chain.Ripple,
        rawTx: '1200aa',
      })
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: expect.stringContaining('engine result'),
    })
  })
})
