import { getNearAccessKey, getNearFeeConfig, getNearFinalBlock } from '@vultisig/core-chain/chains/near/api'
import {
  BLOCK_GAS_PRICE,
  BLOCK_HASH,
  IMPLICIT_GAS_FEE,
  IMPLICIT_RECEIVER,
  MAX_U64,
  MIN_GAS_PURCHASE_PRICE,
  NAMED_GAS_FEE,
  NAMED_RECEIVER,
  NONCE,
  SENDER,
  SENDER_PUBLIC_KEY,
  setupTransport,
  STORAGE_AMOUNT_PER_BYTE,
} from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { NearUnknownEntityError } from '@vultisig/core-chain/chains/near/rpc'
import { getEncodedSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs'
import { buildNearKeysignPayload } from '@vultisig/core-mpc/keysign/tests/helpers/nearKeysignPayload'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import bs58 from 'bs58'
import { Buffer } from 'buffer'

import { getChainSpecific } from '../index'
import { getBlockchainSpecificValue } from '../KeysignChainSpecific'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

// eslint-disable-next-line import/order
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

let walletCore: WalletCore

beforeAll(async () => {
  walletCore = await initWasm()
})

beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('NEAR preparation through the registered chain-specific resolver', () => {
  const prepare = (payload = buildNearKeysignPayload()) => getChainSpecific({ keysignPayload: payload, walletCore })

  it('freezes the successor of a uint64 nonce above 2^53 with the final block hash and the gas reservation', async () => {
    setupTransport({})

    const specific = getBlockchainSpecificValue(await prepare(), 'nearSpecific')

    expect(BigInt(NONCE) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
    // Stale-nonce regression: the access-key nonce itself is not a valid transaction
    // nonce (`verify_nonce`, nearcore runtime/runtime/src/verifier.rs:212-227).
    expect(specific.nonce.toString()).toBe((BigInt(NONCE) + 1n).toString())
    expect(Buffer.from(specific.blockHash).toString('hex')).toBe(Buffer.from(bs58.decode(BLOCK_HASH)).toString('hex'))
    expect(specific.gasFee).toBe(NAMED_GAS_FEE.toString())
  })

  it('reserves the account-creation gas for a 64-hex receiver that already exists', async () => {
    setupTransport({})

    const result = await prepare(buildNearKeysignPayload({ toAddress: IMPLICIT_RECEIVER }))

    expect(getBlockchainSpecificValue(result, 'nearSpecific').gasFee).toBe(IMPLICIT_GAS_FEE.toString())
    expect(Buffer.from(getBlockchainSpecificValue(result, 'nearSpecific').blockHash)).toHaveLength(32)
  })

  it.each([
    ['0x-prefixed recipient', '0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4'],
    ['0s deterministic recipient', '0s85f17cf997934a597031b2e18a9ab6ebd4b9f6a4'],
    ['uppercase recipient', 'WRAP.NEAR'],
    ['double separator', 'wrap..near'],
  ])('rejects an unsupported %s before signing', async (_label, toAddress) => {
    setupTransport({})

    await expect(prepare(buildNearKeysignPayload({ toAddress }))).rejects.toThrow(/recipient/)
  })

  it('fails closed on a function-call key, which cannot send a transfer', async () => {
    setupTransport({
      accessKeyPermission: { FunctionCall: { receiver_id: 'wrap.near', method_names: ['ft_transfer'] } },
    })

    await expect(prepare()).rejects.toThrow(/full access/i)
  })

  it('fails closed when the node does not hold the signing key', async () => {
    setupTransport({ accessKeyError: `access key ed25519:xyz does not exist while viewing` })

    await expect(prepare()).rejects.toBeInstanceOf(NearUnknownEntityError)
  })

  it('stops a named receiver the node does not know before signing, but not an implicit one', async () => {
    setupTransport({ account: { unknown: true } })

    await expect(prepare(buildNearKeysignPayload({ toAddress: NAMED_RECEIVER }))).rejects.toMatchObject({
      type: 'near-destination-not-found',
    })
    await expect(prepare(buildNearKeysignPayload({ toAddress: IMPLICIT_RECEIVER }))).resolves.toBeDefined()
  })

  it('rejects a negative access key nonce instead of preparing a transaction nonce from it', async () => {
    setupTransport({ accessKeyNonce: '-1' })

    await expect(prepare()).rejects.toThrow(/nonce/)
  })

  it('propagates an access-key RPC failure rather than preparing from invented inputs', async () => {
    vi.mocked(queryUrl).mockRejectedValue(new Error('503 Service Unavailable'))

    await expect(prepare()).rejects.toThrow('503 Service Unavailable')
  })

  it('rejects a malformed protocol config instead of pricing a fee from it', async () => {
    setupTransport({ protocolConfig: { runtime_config: { transaction_costs: {} } } })

    await expect(prepare()).rejects.toThrow(/runtime config|transaction_costs/)
  })

  it('reads the final block and protocol config shapes it declares', async () => {
    setupTransport({})

    await expect(getNearFinalBlock()).resolves.toMatchObject({
      hash: BLOCK_HASH,
      gasPrice: BigInt(BLOCK_GAS_PRICE),
      protocolVersion: 86,
    })
    await expect(getNearFeeConfig()).resolves.toMatchObject({
      minGasPurchasePrice: BigInt(MIN_GAS_PURCHASE_PRICE),
      storageAmountPerByte: BigInt(STORAGE_AMOUNT_PER_BYTE),
      addFullAccessKey: { sendSir: 101765125000n, execution: 101765125000n },
    })
  })

  it('asks the node for base58 public keys, which is the only accepted spelling', async () => {
    setupTransport({})

    await getNearAccessKey(SENDER, SENDER_PUBLIC_KEY)

    const [, options] = vi.mocked(queryUrl).mock.calls[0]
    expect((options?.body as { params: { public_key: string } }).params.public_key).toBe(
      `ed25519:${bs58.encode(Buffer.from(SENDER_PUBLIC_KEY, 'hex'))}`
    )
  })

  it.each([
    ['a small access key nonce', '41', '42'],
    ['a zero access key nonce, which is a valid starting state', '0', '1'],
    ['an access key nonce above 2^53, where a double would round', '78000000000000001', '78000000000000002'],
  ])('prepares %s %s as transaction nonce %s', async (_label, accessKeyNonce, expectedTransactionNonce) => {
    setupTransport({ accessKeyNonce })

    const specific = getBlockchainSpecificValue(await prepare(), 'nearSpecific')

    expect(specific.nonce.toString()).toBe(expectedTransactionNonce)
  })

  it('fails closed on the largest uint64 instead of incrementing past the field width', async () => {
    setupTransport({ accessKeyNonce: MAX_U64 })

    await expect(prepare()).rejects.toThrow(/nonce/)
  })

  it('carries the prepared transaction nonce into the signing input without refetching the access key', async () => {
    setupTransport({ accessKeyNonce: '41' })

    const keysignPayload = buildNearKeysignPayload()
    keysignPayload.blockchainSpecific = await getChainSpecific({ keysignPayload, walletCore })

    const fetchesAfterPreparation = vi.mocked(queryUrl).mock.calls.length
    const [txInputData] = await getEncodedSigningInputs({ keysignPayload, walletCore })
    const signingInput = TW.NEAR.Proto.SigningInput.decode(txInputData)

    expect(signingInput.nonce.toString()).toBe('42')
    expect(vi.mocked(queryUrl).mock.calls.length).toBe(fetchesAfterPreparation)
  })
})
