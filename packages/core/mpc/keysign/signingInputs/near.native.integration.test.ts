/**
 * Native NEAR operations through the REAL registries with only the HTTP transport
 * mocked (`queryUrl`): balance, preparation, fee, MAX, local hash, broadcast and
 * finality status. Every asserted number is a literal taken from nearcore protocol
 * 86 sources, not a value read back out of the code under test.
 *
 * `send_tx` is answered by the mocked transport, so real mainnet broadcast remains
 * NOT CHECKED and no wallet or funded account is involved.
 */
import { Buffer } from 'buffer'
import { createHash } from 'crypto'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  getNearAccount,
  getNearAccessKey,
  getNearFeeConfig,
  getNearFinalBlock,
} from '@vultisig/core-chain/chains/near/api'
import { getNearSendLimits } from '@vultisig/core-chain/chains/near/sendLimits'
import { getNearSignerId, getNearTransactionHash } from '@vultisig/core-chain/chains/near/signedTransaction'
import { NearUnknownEntityError, NearRpcError } from '@vultisig/core-chain/chains/near/rpc'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import { broadcastTx } from '@vultisig/core-chain/tx/broadcast'
import { getTxStatus } from '@vultisig/core-chain/tx/status'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { getChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific'
import { getEncodedSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs'
import { getFeeAmount } from '@vultisig/core-mpc/keysign/fee'
import { refineKeysignAmount } from '@vultisig/core-mpc/keysign/refine/amount'
import { NearSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { TW, initWasm, type WalletCore } from '@trustwallet/wallet-core'
import type { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import bs58 from 'bs58'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

// eslint-disable-next-line import/order
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

// Mainnet final block 216116469, 2026-09-17T22:07Z (protocol 86).
const BLOCK_HASH = 'BB5kGq7xVbyw5kfMrRtYmbuUoWKqnNA6xeRU187RF7kx'
const BLOCK_GAS_PRICE = 100_000_000
const MIN_GAS_PURCHASE_PRICE = '1000000000'
const STORAGE_AMOUNT_PER_BYTE = '10000000000000000000'

const SENDER = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
const SENDER_PUBLIC_KEY = SENDER
const NAMED_RECEIVER = 'wrap.near'
const IMPLICIT_RECEIVER = '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'
const NONCE = '78000000000000001'
const MAX_U64 = '18446744073709551615'
const AMOUNT = '1000000000000000000000000'

// Literal reservations: (receipt + transfer) send gas at 1e8 plus the same exec
// gas at max(1e8, 1e9) = 1e9, with 5e11/101765125000 send and 7.2e12/101765125000
// exec added for an implicit receiver.
const NAMED_GAS_FEE = 245_500_818_750_000_000_000n
const IMPLICIT_GAS_FEE = 7_607_442_456_250_000_000_000n

/** 182 bytes of storage (100 account + 33 key + 9 access key + 40 record). */
const IMPLICIT_STORAGE_USAGE = 182
const STORAGE_RESERVE_182 = 1_820_000_000_000_000_000_000n

const PROTOCOL_CONFIG = {
  runtime_config: {
    min_gas_purchase_price: MIN_GAS_PURCHASE_PRICE,
    storage_amount_per_byte: STORAGE_AMOUNT_PER_BYTE,
    transaction_costs: {
      action_creation_config: {
        transfer_cost: { send_sir: 115123062500, send_not_sir: 115123062500, execution: 115123062500 },
        create_account_cost: { send_sir: 500000000000, send_not_sir: 500000000000, execution: 7200000000000 },
        add_key_cost: {
          full_access_cost: { send_sir: 101765125000, send_not_sir: 101765125000, execution: 101765125000 },
        },
      },
      action_receipt_creation_config: {
        send_sir: 108059500000,
        send_not_sir: 108059500000,
        execution: 108059500000,
      },
    },
  },
}

const BLOCK_RESPONSE = {
  header: { hash: BLOCK_HASH, gas_price: BLOCK_GAS_PRICE, height: 216116469, latest_protocol_version: 86 },
}

type AccountFixture = { amount?: string; locked?: string; storage_usage?: number; unknown?: boolean }

type Fixtures = {
  account?: AccountFixture
  accessKeyError?: string
  accessKeyPermission?: unknown
  accessKeyNonce?: string
  protocolConfig?: unknown
  sendTx?: unknown
  sendTxError?: unknown
  status?: unknown
  statusError?: unknown
}

const UNKNOWN_ACCOUNT_ERROR = {
  name: 'HANDLER_ERROR',
  cause: { name: 'UNKNOWN_ACCOUNT', info: { requested_account_id: SENDER } },
  code: -32000,
  message: 'Server error',
  data: `account ${SENDER} does not exist while viewing`,
}

const buildNearBody = ({ receiverId, deposit, nonce }: { receiverId: string; deposit: bigint; nonce: bigint }) => {
  const u32 = (value: number) => {
    const bytes = Buffer.alloc(4)
    bytes.writeUInt32LE(value)
    return bytes
  }
  const str = (value: string) => Buffer.concat([u32(Buffer.byteLength(value)), Buffer.from(value, 'utf8')])
  const u64 = Buffer.alloc(8)
  u64.writeBigUInt64LE(nonce)
  const u128 = Buffer.alloc(16)
  u128.writeBigUInt64LE(deposit & 0xffffffffffffffffn, 0)
  u128.writeBigUInt64LE(deposit >> 64n, 8)

  return Buffer.concat([
    str(SENDER),
    Buffer.from([0x00]),
    Buffer.from(SENDER_PUBLIC_KEY, 'hex'),
    u64,
    str(receiverId),
    createHash('sha256').update(BLOCK_HASH).digest(),
    u32(1),
    Buffer.from([0x03]),
    u128,
  ])
}

const buildSignedTransaction = (body: Buffer) => Buffer.concat([body, Buffer.from([0x00]), Buffer.alloc(64, 0x11)])

const setupTransport = (fixtures: Fixtures) => {
  const account = fixtures.account ?? { amount: AMOUNT }

  vi.mocked(queryUrl).mockImplementation(async (_url, options) => {
    const body = options?.body as { method?: string; params?: Record<string, unknown> }
    const text = (value: unknown) => JSON.stringify(value)
    const isText = (options as { responseType?: string }).responseType === 'text'

    const respond = (value: unknown) => (isText ? text(value) : value)

    switch (body.method) {
      case 'EXPERIMENTAL_protocol_config':
        return respond({ result: fixtures.protocolConfig ?? PROTOCOL_CONFIG })
      case 'block':
        return respond({ result: BLOCK_RESPONSE })
      case 'send_tx':
        return respond(fixtures.sendTxError ? { error: fixtures.sendTxError } : { result: fixtures.sendTx })
      case 'tx':
        return respond(fixtures.statusError ? { error: fixtures.statusError } : { result: fixtures.status })
      case 'query': {
        const requestType = body.params?.request_type

        if (requestType === 'view_account') {
          if (account.unknown) {
            return respond({ error: UNKNOWN_ACCOUNT_ERROR })
          }

          return respond({
            result: {
              amount: account.amount ?? AMOUNT,
              locked: account.locked ?? '0',
              storage_usage: account.storage_usage ?? IMPLICIT_STORAGE_USAGE,
            },
          })
        }

        if (requestType === 'view_access_key') {
          return fixtures.accessKeyError
            ? text({ result: { error: fixtures.accessKeyError } })
            : `{"result":{"nonce":${fixtures.accessKeyNonce ?? NONCE},"permission":${JSON.stringify(
                fixtures.accessKeyPermission ?? 'FullAccess'
              )}}}`
        }

        throw new Error(`unexpected query request_type ${String(requestType)}`)
      }
      default:
        throw new Error(`unexpected NEAR method ${String(body.method)}`)
    }
  })
}

const buildPayload = ({
  toAddress = NAMED_RECEIVER,
  toAmount = AMOUNT,
  gasFee = NAMED_GAS_FEE.toString(),
  nonce = BigInt(NONCE),
  blockHash = Buffer.from(createHash('sha256').update(BLOCK_HASH).digest()),
  isNativeToken = true,
}: {
  toAddress?: string
  toAmount?: string
  gasFee?: string
  nonce?: bigint
  blockHash?: Uint8Array
  isNativeToken?: boolean
} = {}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Near,
      ticker: 'NEAR',
      address: SENDER,
      decimals: 24,
      isNativeToken,
      hexPublicKey: SENDER_PUBLIC_KEY,
    }),
    toAddress,
    toAmount,
    blockchainSpecific: {
      case: 'nearSpecific',
      value: create(NearSpecificSchema, {
        nonce,
        blockHash,
        gasFee,
      }),
    },
  })

let walletCore: WalletCore
let publicKey: PublicKey

beforeAll(async () => {
  walletCore = await initWasm()
  publicKey = walletCore.PublicKey.createWithData(
    Buffer.from(SENDER_PUBLIC_KEY, 'hex'),
    walletCore.PublicKeyType.ed25519
  )
})

afterAll(() => {
  publicKey.delete()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('NEAR native balance through the registered resolver', () => {
  it('reports the raw unlocked amount, keeping the storage stake visible in the balance', async () => {
    setupTransport({ account: { amount: AMOUNT, locked: '5', storage_usage: IMPLICIT_STORAGE_USAGE } })

    await expect(getCoinBalance({ chain: Chain.Near, address: SENDER })).resolves.toBe(BigInt(AMOUNT))
  })

  it('reports an unfunded account as zero without hiding a network failure', async () => {
    setupTransport({ account: { unknown: true } })

    await expect(getCoinBalance({ chain: Chain.Near, address: SENDER })).resolves.toBe(0n)
  })

  it.each([[new Error('503 Service Unavailable')], [new Error('fetch failed')]])(
    'propagates a transport failure instead of returning zero (%s)',
    async failure => {
      vi.mocked(queryUrl).mockRejectedValue(failure)

      await expect(getCoinBalance({ chain: Chain.Near, address: SENDER })).rejects.toThrow(failure.message)
    }
  )

  it('rejects an unsupported NEAR token balance instead of reporting zero', async () => {
    setupTransport({})

    await expect(getCoinBalance({ chain: Chain.Near, address: SENDER, id: 'usdc.near' })).rejects.toThrow(/NEP-141/)
  })

  it('rejects a malformed amount instead of rounding it', async () => {
    vi.mocked(queryUrl).mockResolvedValue(
      JSON.stringify({ result: { amount: '1.5', locked: '0', storage_usage: IMPLICIT_STORAGE_USAGE } })
    )

    await expect(getNearAccount(SENDER)).rejects.toThrow(/account amount/)
  })
})

describe('NEAR preparation through the registered chain-specific resolver', () => {
  const prepare = (payload = buildPayload()) => getChainSpecific({ keysignPayload: payload, walletCore })

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

    const result = await prepare(buildPayload({ toAddress: IMPLICIT_RECEIVER }))

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

    await expect(prepare(buildPayload({ toAddress }))).rejects.toThrow(/recipient/)
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

    const keysignPayload = buildPayload()
    keysignPayload.blockchainSpecific = await getChainSpecific({ keysignPayload, walletCore })

    const fetchesAfterPreparation = vi.mocked(queryUrl).mock.calls.length
    const [txInputData] = await getEncodedSigningInputs({ keysignPayload, walletCore })
    const signingInput = TW.NEAR.Proto.SigningInput.decode(txInputData)

    expect(signingInput.nonce.toString()).toBe('42')
    expect(vi.mocked(queryUrl).mock.calls.length).toBe(fetchesAfterPreparation)
  })
})

describe('NEAR fee and MAX through the registered seams', () => {
  it('returns the frozen gas reservation as the fee', async () => {
    setupTransport({})

    const payload = buildPayload()

    await expect(getFeeAmount({ keysignPayload: payload, walletCore, publicKey })).resolves.toBe(NAMED_GAS_FEE)
  })

  it.each([[''], ['1.5'], ['-1'], ['0x10']])(
    'rejects a gas reservation that is not unsigned decimal %j',
    async gasFee => {
      setupTransport({})

      await expect(getFeeAmount({ keysignPayload: buildPayload({ gasFee }), walletCore, publicKey })).rejects.toThrow(
        /gas fee/
      )
    }
  )

  it('computes MAX as balance minus gas reservation minus the storage reserve', async () => {
    setupTransport({ account: { amount: AMOUNT, storage_usage: 1_000 } })

    await expect(getNearSendLimits({ address: SENDER, receiver: NAMED_RECEIVER })).resolves.toEqual({
      amount: BigInt(AMOUNT),
      gasReservation: NAMED_GAS_FEE,
      storageReserve: 10_000_000_000_000_000_000_000n,
      maxSendable: BigInt(AMOUNT) - NAMED_GAS_FEE - 10_000_000_000_000_000_000_000n,
    })
  })

  it('takes the cheaper self-send reservation and still reserves the receiver creation gas', async () => {
    setupTransport({})

    await expect(getNearSendLimits({ address: SENDER, receiver: SENDER })).resolves.toMatchObject({
      gasReservation: IMPLICIT_GAS_FEE,
      storageReserve: 0n,
      maxSendable: BigInt(AMOUNT) - IMPLICIT_GAS_FEE,
    })
  })

  it.each([
    ['zero-balance account at 770 bytes', 770, 0n],
    ['account one byte above the zero-balance limit', 771, 7_710_000_000_000_000_000_000n],
  ])('applies the NEP-448 exemption to a %s', async (_label, storageUsage, expectedReserve) => {
    setupTransport({ account: { storage_usage: storageUsage } })

    const limits = await getNearSendLimits({ address: SENDER, receiver: NAMED_RECEIVER })

    expect(limits.storageReserve).toBe(expectedReserve)
    expect(limits.maxSendable).toBe(BigInt(AMOUNT) - NAMED_GAS_FEE - expectedReserve)
  })

  it('lets locked stake back the storage requirement without becoming spendable', async () => {
    setupTransport({ account: { storage_usage: 1_000, locked: '10000000000000000000000' } })

    const limits = await getNearSendLimits({ address: SENDER, receiver: NAMED_RECEIVER })

    expect(limits.storageReserve).toBe(0n)
    expect(limits.amount).toBe(BigInt(AMOUNT))
    expect(limits.maxSendable).toBe(BigInt(AMOUNT) - NAMED_GAS_FEE)
  })
})

describe('NEAR regular sends cannot be quietly reduced', () => {
  it('keeps an affordable regular amount exactly as requested', async () => {
    setupTransport({})

    const payload = buildPayload({ toAmount: '1000' })

    const refined = await refineKeysignAmount({
      keysignPayload: payload,
      walletCore,
      publicKey,
      balance: BigInt(AMOUNT),
    })

    expect(refined.toAmount).toBe('1000')
  })

  it('rejects an over-balance send instead of lowering the amount', async () => {
    setupTransport({})

    const payload = buildPayload({ toAmount: '1000' })

    await expect(
      refineKeysignAmount({
        keysignPayload: payload,
        walletCore,
        publicKey,
        balance: BigInt(NAMED_GAS_FEE) + 999n,
      })
    ).rejects.toThrow(/not enough|needs/i)
  })

  it('rejects a send that would leave the account unable to back its own storage', async () => {
    setupTransport({ account: { storage_usage: 1_000 } })

    const payload = buildPayload({ toAmount: '1000' })
    // One yoctoNEAR short of amount + gas reservation + the 1e22 storage reserve.
    const balance = NAMED_GAS_FEE + 10_000_000_000_000_000_000_000n + 999n

    await expect(refineKeysignAmount({ keysignPayload: payload, walletCore, publicKey, balance })).rejects.toThrow(
      /storage reserve/
    )
  })
})

describe('NEAR local transaction hash and broadcast binding', () => {
  const body = buildNearBody({ receiverId: NAMED_RECEIVER, deposit: 1000n, nonce: BigInt(NONCE) })
  const signedTransaction = buildSignedTransaction(body)
  const expectedHash = bs58.encode(createHash('sha256').update(body).digest())
  const signingOutput = decodeSigningOutput(
    Chain.Near,
    TW.NEAR.Proto.SigningOutput.encode(TW.NEAR.Proto.SigningOutput.create({ signedTransaction })).finish()
  )

  it('hashes the unsigned body, which is the digest that was signed, never the signed bytes', () => {
    expect(getTxHash({ chain: Chain.Near, tx: signingOutput })).toBe(expectedHash)
    expect(bs58.encode(createHash('sha256').update(signedTransaction).digest())).not.toBe(expectedHash)
    expect(getNearSignerId(signedTransaction)).toBe(SENDER)
  })

  it.each([
    ['too short to carry a signature', Buffer.alloc(10)],
    ['not Ed25519', Buffer.concat([body, Buffer.from([0x01]), Buffer.alloc(64)])],
  ])('refuses to derive a hash from a %s', async (_label, malformed) => {
    expect(() => getNearTransactionHash(malformed)).toThrow(/signature/)
  })

  it('accepts the node acknowledgment that matches the locally derived hash', async () => {
    setupTransport({ sendTx: { final_execution_status: 'INCLUDED', transaction: { hash: expectedHash } } })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'accepted',
      finality: 'pending',
      txHash: expectedHash,
    })
  })

  it('fails a mismatched hash instead of reporting someone else s transaction', async () => {
    setupTransport({
      sendTx: {
        final_execution_status: 'INCLUDED',
        transaction: { hash: 'BB5kGq7xVbyw5kfMrRtYmbuUoWKqnNA6xeRU187RF7kx' },
      },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
    })
  })

  it('does not treat a definitive rejection as an accepted broadcast', async () => {
    setupTransport({
      sendTxError: {
        name: 'INVALID_TRANSACTION',
        cause: { name: 'INVALID_TRANSACTION' },
        code: -32000,
        message: 'Invalid transaction',
        data: 'nonce too small',
      },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
    })
  })

  it('verifies an ambiguous timeout against the chain instead of assuming success', async () => {
    setupTransport({
      sendTxError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'TIMEOUT_ERROR' },
        code: -32000,
        message: 'Server error',
        data: 'Timeout',
      },
      status: {
        final_execution_status: 'FINAL',
        status: { SuccessValue: '' },
        transaction: { hash: expectedHash },
      },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'accepted',
      txHash: expectedHash,
    })
  })

  it('keeps a timeout failed when the chain does not know the transaction', async () => {
    setupTransport({
      sendTxError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'TIMEOUT_ERROR' },
        code: -32000,
        message: 'Server error',
        data: 'Timeout',
      },
      status: { final_execution_status: 'NONE' },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({ status: 'failed' })
  })
})

describe('NEAR finality status', () => {
  const hash = 'BB5kGq7xVbyw5kfMrRtYmbuUoWKqnNA6xeRU187RF7kx'

  it('binds success to a final execution outcome for the same hash', async () => {
    setupTransport({
      status: { final_execution_status: 'FINAL', status: { SuccessReceiptId: hash }, transaction: { hash } },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'success',
      isKnown: true,
    })
  })

  it('reports an executed failure as an error, not a success', async () => {
    setupTransport({
      status: {
        final_execution_status: 'FINAL',
        status: {
          Failure: { ActionError: { index: 0, kind: { AccountAlreadyExists: { account_id: NAMED_RECEIVER } } } },
        },
        transaction: { hash },
      },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'error',
    })
  })

  it.each([['NONE'], ['INCLUDED'], ['EXECUTED_OPTIMISTIC'], ['EXECUTED']])(
    'never reports %s as success',
    async finalExecutionStatus => {
      setupTransport({
        status: { final_execution_status: finalExecutionStatus, status: { SuccessValue: '' }, transaction: { hash } },
      })

      await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
        status: 'pending',
      })
    }
  )

  it('reports an unknown hash as not found', async () => {
    setupTransport({
      statusError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'UNKNOWN_TRANSACTION' },
        code: -32000,
        message: 'Server error',
        data: 'Transaction does not exist',
      },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('keeps an unanswered lookup pending rather than claiming it failed', async () => {
    setupTransport({
      statusError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'TIMEOUT_ERROR' },
        code: -32000,
        message: 'Server error',
        data: 'Timeout',
      },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'pending',
      isKnown: false,
    })
  })

  it('fails closed without the sender the node needs, and propagates malformed status', async () => {
    setupTransport({})

    await expect(getTxStatus({ chain: Chain.Near, hash })).rejects.toThrow(/sender/)

    setupTransport({ status: { final_execution_status: 'FINAL', status: { UnknownOutcome: {} } } })
    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).rejects.toThrow(/unrecognized/)
  })

  it('propagates a status RPC failure instead of reporting pending', async () => {
    vi.mocked(queryUrl).mockRejectedValue(new NearRpcError('tx', 'INTERNAL_ERROR', 'node is behind', undefined))

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).rejects.toThrow(/INTERNAL_ERROR/)
  })
})
