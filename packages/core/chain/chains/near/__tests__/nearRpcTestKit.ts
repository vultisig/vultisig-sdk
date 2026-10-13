/**
 * NEAR JSON-RPC fixtures for tests that run the REAL registries with only the HTTP
 * transport (`queryUrl`) mocked. Every number is a literal from nearcore protocol 86
 * sources, not a value read back out of the code under test. `send_tx` is answered
 * here, so real mainnet broadcast remains NOT CHECKED.
 */
import { TW } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import bs58 from 'bs58'
import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import { vi } from 'vitest'

// Mainnet final block 216116469, 2026-09-17T22:07Z (protocol 86).
export const BLOCK_HASH = 'BB5kGq7xVbyw5kfMrRtYmbuUoWKqnNA6xeRU187RF7kx'
export const BLOCK_GAS_PRICE = 100_000_000
export const MIN_GAS_PURCHASE_PRICE = '1000000000'
export const STORAGE_AMOUNT_PER_BYTE = '10000000000000000000'

export const SENDER = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
export const SENDER_PUBLIC_KEY = SENDER
export const NAMED_RECEIVER = 'wrap.near'
export const IMPLICIT_RECEIVER = '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'
export const NONCE = '78000000000000001'
export const MAX_U64 = '18446744073709551615'
export const AMOUNT = '1000000000000000000000000'

// Literal reservations: (receipt + transfer) send gas at 1e8 plus the same exec
// gas at max(1e8, 1e9) = 1e9, with 5e11/101765125000 send and 7.2e12/101765125000
// exec added for an implicit receiver.
export const NAMED_GAS_FEE = 245_500_818_750_000_000_000n
export const IMPLICIT_GAS_FEE = 7_607_442_456_250_000_000_000n

/** 182 bytes of storage (100 account + 33 key + 9 access key + 40 record). */
export const IMPLICIT_STORAGE_USAGE = 182

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

export const setupTransport = (fixtures: Fixtures) => {
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

/** A signed NEAR transfer and the hash the chain gives it: sha256 of the unsigned body. */
export const buildNearSignedTransfer = () => {
  const body = buildNearBody({ receiverId: NAMED_RECEIVER, deposit: 1000n, nonce: BigInt(NONCE) })
  const signedTransaction = buildSignedTransaction(body)

  return {
    body,
    signedTransaction,
    expectedHash: bs58.encode(createHash('sha256').update(body).digest()),
    signingOutput: decodeSigningOutput(
      Chain.Near,
      TW.NEAR.Proto.SigningOutput.encode(TW.NEAR.Proto.SigningOutput.create({ signedTransaction })).finish()
    ),
  }
}
