/**
 * Native NEAR frozen-transfer signing through the REAL path: registry dispatch
 * (`getEncodedSigningInputs`) -> WalletCore encoder -> generic preimage -> generic
 * compile (`compileTx`), checked byte-for-byte against an independent Borsh
 * serializer plus signatures produced outside WalletCore by node's RFC 8032 Ed25519.
 *
 * Key material is RFC 8032 §7.1 TEST 1 / TEST 2 (published vectors, TEST ONLY).
 * Never a wallet, never a network call.
 */
import { Buffer } from 'buffer'
import { createHash, createPrivateKey, sign as signEd25519 } from 'crypto'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { NearSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import {
  type KeysignPayload,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { THORChainSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/thorchain_swap_payload_pb'
import {
  SignDirectSchema,
  WasmExecuteContractPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { TW, initWasm, type WalletCore } from '@trustwallet/wallet-core'
import type { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { KeysignSignature } from '../KeysignSignature'
import { compileTx } from '../../tx/compile/compileTx'
import { getPreSigningHashes } from '../../tx/preSigningHashes'
import { getEncodedSigningInputs } from './index'

// RFC 8032 §7.1 TEST 1 / TEST 2 — published test vectors, no funds, no wallet.
const TEST_SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
const TEST_PUBLIC_KEY_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
const TEST_EMPTY_MESSAGE_SIGNATURE_HEX =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
const PEER_PUBLIC_KEY_HEX = '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'
const SENDER_IMPLICIT = TEST_PUBLIC_KEY_HEX
const IMPLICIT_RECEIVER = PEER_PUBLIC_KEY_HEX
const NAMED_RECEIVER = 'wrap.near'
const NONCE = 78000000000000001n
const BLOCK_HASH = createHash('sha256').update('vultisig-near-block-hash-fixture').digest()
const DEPOSIT_YOCTO = '1234567890123456789012345'
const GAS_FEE_YOCTO = '115123062500'
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

const ED25519_KEY_TYPE = 0x00
const ACTION_TRANSFER = 0x03

// Layout: nearcore `core/primitives/src/transaction.rs` (TransactionV0) and
// `core/primitives/src/action/mod.rs` (Action::Transfer). Written independently
// of WalletCore so the assertions cannot silently agree with its encoder.
const encodeU32Le = (value: number) => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}

const encodeU64Le = (value: bigint) => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(value)
  return bytes
}

const encodeU128Le = (value: bigint) => {
  const bytes = Buffer.alloc(16)
  bytes.writeBigUInt64LE(value & 0xffffffffffffffffn, 0)
  bytes.writeBigUInt64LE(value >> 64n, 8)
  return bytes
}

const encodeNearString = (value: string) => {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([encodeU32Le(bytes.length), bytes])
}

const buildTransactionBody = ({ receiverId, deposit }: { receiverId: string; deposit: bigint }) =>
  Buffer.concat([
    encodeNearString(SENDER_IMPLICIT),
    Buffer.from([ED25519_KEY_TYPE]),
    Buffer.from(TEST_PUBLIC_KEY_HEX, 'hex'),
    encodeU64Le(NONCE),
    encodeNearString(receiverId),
    BLOCK_HASH,
    encodeU32Le(1),
    Buffer.from([ACTION_TRANSFER]),
    encodeU128Le(deposit),
  ])

const buildSignedTransaction = (body: Buffer, signature: Buffer) =>
  Buffer.concat([body, Buffer.from([ED25519_KEY_TYPE]), signature])

const loadTestPrivateKey = () =>
  createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(TEST_SEED_HEX, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

type PayloadOverrides = {
  toAddress?: string
  toAmount?: string
  gasFee?: string
  nonce?: bigint
  blockHash?: Uint8Array
  senderAddress?: string
  hexPublicKey?: string
  isNativeToken?: boolean
  ticker?: string
  memo?: string
  withSwapPayload?: boolean
  swapPayload?: KeysignPayload['swapPayload']
  withContractPayload?: boolean
  withSignData?: boolean
}

const buildNearPayload = (overrides: PayloadOverrides = {}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Near,
      ticker: overrides.ticker ?? 'NEAR',
      address: overrides.senderAddress ?? SENDER_IMPLICIT,
      decimals: 24,
      isNativeToken: overrides.isNativeToken ?? true,
      hexPublicKey: overrides.hexPublicKey ?? TEST_PUBLIC_KEY_HEX,
    }),
    toAddress: overrides.toAddress ?? NAMED_RECEIVER,
    toAmount: overrides.toAmount ?? DEPOSIT_YOCTO,
    blockchainSpecific: {
      case: 'nearSpecific',
      value: create(NearSpecificSchema, {
        nonce: overrides.nonce ?? NONCE,
        blockHash: overrides.blockHash ?? BLOCK_HASH,
        gasFee: overrides.gasFee ?? GAS_FEE_YOCTO,
      }),
    },
    memo: overrides.memo,
    swapPayload:
      overrides.swapPayload ??
      (overrides.withSwapPayload
        ? { case: 'thorchainSwapPayload', value: create(THORChainSwapPayloadSchema, {}) }
        : undefined),
    contractPayload: overrides.withContractPayload
      ? {
          case: 'wasmExecuteContractPayload',
          value: create(WasmExecuteContractPayloadSchema, {}),
        }
      : undefined,
    signData: overrides.withSignData
      ? {
          case: 'signDirect',
          value: create(SignDirectSchema, {
            bodyBytes: '0xdeadbeef',
            authInfoBytes: '0xdeadbeef',
            chainId: 'near-test',
            accountNumber: '1',
          }),
        }
      : undefined,
  })

type SignedRun = {
  signingInput: TW.NEAR.Proto.SigningInput
  signerPublicKey: PublicKey
  preSigningHash: Buffer
  compiledSignedTransaction: Buffer
}

const runFrozenTransfer = async ({
  walletCore,
  receiverId,
  payload = buildNearPayload({ toAddress: receiverId }),
  expectedBody,
}: {
  walletCore: WalletCore
  receiverId: string
  payload?: ReturnType<typeof buildNearPayload>
  expectedBody: Buffer
}): Promise<SignedRun> => {
  const signingInputs = await getEncodedSigningInputs({ keysignPayload: payload, walletCore })
  expect(signingInputs).toHaveLength(1)

  const [txInputData] = signingInputs
  const signingInput = TW.NEAR.Proto.SigningInput.decode(txInputData)
  expect(signingInput.privateKey).toHaveLength(0)

  const preSigningHashes = getPreSigningHashes({
    walletCore,
    chain: Chain.Near,
    txInputData,
    keysignPayload: payload,
  })
  expect(preSigningHashes).toHaveLength(1)
  const preSigningHash = Buffer.from(preSigningHashes[0])

  expect(preSigningHash.equals(createHash('sha256').update(expectedBody).digest())).toBe(true)

  const signature = Buffer.from(signEd25519(null, preSigningHash, loadTestPrivateKey()))

  const signerPublicKey = walletCore.PublicKey.createWithData(
    Buffer.from(TEST_PUBLIC_KEY_HEX, 'hex'),
    walletCore.PublicKeyType.ed25519
  )

  const keysignSignature: KeysignSignature = {
    msg: hex(preSigningHash),
    r: hex(signature.subarray(0, 32)),
    s: hex(signature.subarray(32)),
    der_signature: '',
  }

  const compiled = compileTx({
    publicKey: signerPublicKey,
    txInputData,
    signatures: { [hex(preSigningHash)]: keysignSignature },
    chain: Chain.Near,
    walletCore,
    keysignPayload: payload,
  })

  const signingOutput = TW.NEAR.Proto.SigningOutput.decode(compiled)
  expect(signingOutput.errorMessage).toBe('')

  const compiledSignedTransaction = Buffer.from(signingOutput.signedTransaction)
  expect(compiledSignedTransaction.equals(buildSignedTransaction(expectedBody, signature))).toBe(true)

  return { signingInput, signerPublicKey, preSigningHash, compiledSignedTransaction }
}

let walletCore: WalletCore

beforeAll(async () => {
  walletCore = await initWasm()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('NEAR frozen native transfer — real registry, preimage and compile path', () => {
  it('signs with RFC 8032 §7.1 TEST 1 material, never a wallet key', () => {
    expect(hex(signEd25519(null, Buffer.alloc(0), loadTestPrivateKey()))).toBe(TEST_EMPTY_MESSAGE_SIGNATURE_HEX)
  })

  it.each([
    ['named receiver', NAMED_RECEIVER],
    ['implicit receiver', IMPLICIT_RECEIVER],
  ])('signs and compiles %s against independently built Borsh bytes', async (_label, receiverId) => {
    const run = await runFrozenTransfer({
      walletCore,
      receiverId,
      expectedBody: buildTransactionBody({ receiverId, deposit: BigInt(DEPOSIT_YOCTO) }),
    })

    expect(run.signingInput.signerId).toBe(SENDER_IMPLICIT)
    expect(run.signingInput.receiverId).toBe(receiverId)
    expect(run.signingInput.nonce.toString()).toBe(NONCE.toString())
    expect(hex(run.signingInput.blockHash)).toBe(hex(BLOCK_HASH))
    expect(hex(run.signingInput.publicKey)).toBe(TEST_PUBLIC_KEY_HEX)
    expect(run.signingInput.actions).toHaveLength(1)

    const transfer = run.signingInput.actions[0]?.transfer
    if (!transfer) {
      throw new Error('expected the NEAR signing input to carry one transfer action')
    }
    expect(hex(transfer.deposit ?? new Uint8Array())).toBe(hex(encodeU128Le(BigInt(DEPOSIT_YOCTO))))

    run.signerPublicKey.delete()
  })

  it('preserves a uint64 nonce above 2^53 in the signed bytes', async () => {
    const receiverId = NAMED_RECEIVER
    const run = await runFrozenTransfer({
      walletCore,
      receiverId,
      expectedBody: buildTransactionBody({ receiverId, deposit: BigInt(DEPOSIT_YOCTO) }),
    })

    expect(NONCE > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(run.compiledSignedTransaction.includes(encodeU64Le(NONCE))).toBe(true)
    expect(
      run.compiledSignedTransaction.toString('hex').startsWith(
        buildTransactionBody({
          receiverId,
          deposit: BigInt(DEPOSIT_YOCTO),
        }).toString('hex')
      )
    ).toBe(true)

    run.signerPublicKey.delete()
  })

  it('freezes the inputs: identical payloads produce identical preimages and signed bytes', async () => {
    const payload = buildNearPayload({ toAddress: IMPLICIT_RECEIVER })
    const expectedBody = buildTransactionBody({
      receiverId: IMPLICIT_RECEIVER,
      deposit: BigInt(DEPOSIT_YOCTO),
    })

    const first = await runFrozenTransfer({ walletCore, receiverId: IMPLICIT_RECEIVER, payload, expectedBody })
    const second = await runFrozenTransfer({ walletCore, receiverId: IMPLICIT_RECEIVER, payload, expectedBody })

    expect(hex(first.preSigningHash)).toBe(hex(second.preSigningHash))
    expect(hex(first.compiledSignedTransaction)).toBe(hex(second.compiledSignedTransaction))

    first.signerPublicKey.delete()
    second.signerPublicKey.delete()
  })

  it('treats gasFee as reservation metadata: mutating it changes no signed byte', async () => {
    const expectedBody = buildTransactionBody({ receiverId: NAMED_RECEIVER, deposit: BigInt(DEPOSIT_YOCTO) })

    const baseline = await runFrozenTransfer({ walletCore, receiverId: NAMED_RECEIVER, expectedBody })
    const inflated = await runFrozenTransfer({
      walletCore,
      receiverId: NAMED_RECEIVER,
      payload: buildNearPayload({ gasFee: '999999999999999999999999' }),
      expectedBody,
    })

    expect(hex(inflated.compiledSignedTransaction)).toBe(hex(baseline.compiledSignedTransaction))
    expect(hex(inflated.preSigningHash)).toBe(hex(baseline.preSigningHash))

    baseline.signerPublicKey.delete()
    inflated.signerPublicKey.delete()
  })

  it('signs without touching the network', async () => {
    const forbidden = vi.fn(() => {
      throw new Error('network access is forbidden while signing a frozen NEAR payload')
    })
    vi.stubGlobal('fetch', forbidden)

    const run = await runFrozenTransfer({
      walletCore,
      receiverId: NAMED_RECEIVER,
      expectedBody: buildTransactionBody({ receiverId: NAMED_RECEIVER, deposit: BigInt(DEPOSIT_YOCTO) }),
    })

    expect(forbidden).not.toHaveBeenCalled()
    expect(run.compiledSignedTransaction.length).toBeGreaterThan(0)

    run.signerPublicKey.delete()
  })
})

const swapKitDeposit = (
  overrides: Partial<{
    targetAddress: string
    fromAmount: string
    txPayload: Uint8Array
    txType: string
    memo: string
  }> = {}
): KeysignPayload['swapPayload'] => ({
  case: 'swapkitSwapPayload',
  value: create(SwapKitSwapPayloadSchema, {
    fromCoin: create(CoinSchema, { chain: Chain.Near, ticker: 'NEAR', isNativeToken: true, decimals: 24 }),
    fromAmount: overrides.fromAmount ?? DEPOSIT_YOCTO,
    targetAddress: overrides.targetAddress ?? IMPLICIT_RECEIVER,
    txType: overrides.txType ?? '',
    txPayload: overrides.txPayload ?? new Uint8Array(),
    ...(overrides.memo ? { memo: overrides.memo } : {}),
    subProvider: 'NEAR',
  }),
})

describe('NEAR SwapKit deposit swap', () => {
  it('signs exactly the plain transfer to the deposit address', async () => {
    const plain = await getEncodedSigningInputs({
      keysignPayload: buildNearPayload({ toAddress: IMPLICIT_RECEIVER }),
      walletCore,
    })
    const swap = await getEncodedSigningInputs({
      keysignPayload: buildNearPayload({ toAddress: IMPLICIT_RECEIVER, swapPayload: swapKitDeposit() }),
      walletCore,
    })

    expect(swap.map(hex)).toEqual(plain.map(hex))
  })
})

describe('NEAR frozen native transfer — fail closed', () => {
  const rejects = async (overrides: PayloadOverrides, expected: RegExp) => {
    await expect(async () =>
      getEncodedSigningInputs({ keysignPayload: buildNearPayload(overrides), walletCore })
    ).rejects.toThrow(expected)
  }

  it.each([
    ['uppercase implicit receiver', IMPLICIT_RECEIVER.toUpperCase()],
    ['0x-prefixed destination', '0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4'],
    ['0s deterministic destination', '0s85f17cf997934a597031b2e18a9ab6ebd4b9f6a4'],
    ['double separator', 'wrap..near'],
    ['leading separator', '-wrap.near'],
    ['trailing separator', 'wrap.near-'],
    ['single character', 'a'],
    ['uppercase named receiver', 'WRAP.NEAR'],
    ['over-long receiver', `${'a'.repeat(64)}.near`],
  ])('rejects an unsupported %s', async (_label, toAddress) => {
    await rejects({ toAddress }, /receiver|account id/i)
  })

  it.each([['0'], ['-1'], ['1.5'], ['0x10'], ['1e3'], ['']])(
    'rejects a non-positive or malformed deposit %j',
    async toAmount => {
      await rejects({ toAmount }, /amount|deposit/i)
    }
  )

  it('rejects a deposit above u128', async () => {
    await rejects({ toAmount: (1n << 128n).toString() }, /amount|deposit/i)
  })

  it('rejects a zero nonce', async () => {
    await rejects({ nonce: 0n }, /nonce/i)
  })

  it('rejects a nonce above uint64', async () => {
    await rejects({ nonce: 1n << 64n }, /nonce/i)
  })

  it.each([
    ['short', BLOCK_HASH.subarray(0, 31)],
    ['long', Buffer.concat([BLOCK_HASH, Buffer.from([0x01])])],
    ['empty', new Uint8Array(0)],
  ])('rejects a %s block hash', async (_label, blockHash) => {
    await rejects({ blockHash }, /block hash/i)
  })

  it.each([['1.5'], ['-1'], ['0x10'], ['']])('rejects an unsigned-decimal violation in gasFee %j', async gasFee => {
    await rejects({ gasFee }, /gas fee/i)
  })

  it('rejects a sender address that is not the selected EdDSA key implicit account', async () => {
    await rejects({ senderAddress: IMPLICIT_RECEIVER }, /sender/i)
  })

  it('rejects an uppercase sender address instead of normalizing it', async () => {
    await rejects({ senderAddress: SENDER_IMPLICIT.toUpperCase() }, /sender/i)
  })

  it('rejects a non-Ed25519 / wrong-length public key', async () => {
    await rejects({ hexPublicKey: TEST_PUBLIC_KEY_HEX.slice(0, 62) }, /public key/i)
  })

  it('rejects a token coin for the native transfer path', async () => {
    await rejects({ isNativeToken: false, ticker: 'USDC' }, /native/i)
  })

  it('rejects a memo, which NEAR cannot carry on a Transfer', async () => {
    await rejects({ memo: 'invoice 42' }, /memo/i)
  })

  it('rejects a non-SwapKit swap payload', async () => {
    await rejects({ withSwapPayload: true }, /swap/i)
  })

  it.each([
    ['a deposit address other than the transfer receiver', { targetAddress: NAMED_RECEIVER }, /deposit address/i],
    ['an amount other than the transfer amount', { fromAmount: '1' }, /amount/i],
    ['pre-built transaction bytes', { txPayload: new Uint8Array([1]) }, /pre-built/i],
    ['a transaction type', { txType: 'NEAR' }, /pre-built/i],
    ['a memo', { memo: 'deposit-tag' }, /memo/i],
  ] as const)('rejects a SwapKit deposit carrying %s', async (_, swapOverrides, expected) => {
    await rejects({ toAddress: IMPLICIT_RECEIVER, swapPayload: swapKitDeposit(swapOverrides) }, expected)
  })

  it('rejects a contract payload', async () => {
    await rejects({ withContractPayload: true }, /contract/i)
  })

  it('rejects custom sign payloads', async () => {
    await rejects({ withSignData: true }, /sign/i)
  })
})

describe('NEAR frozen native transfer — serialized schema round trip', () => {
  it('round-trips a uint64 nonce above 2^53 with the block hash and gas fee intact', () => {
    const nonce = 78000000000000001n
    expect(nonce > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)

    const nearSpecific = create(NearSpecificSchema, {
      nonce,
      blockHash: BLOCK_HASH,
      gasFee: GAS_FEE_YOCTO,
    })

    const decoded = fromBinary(NearSpecificSchema, toBinary(NearSpecificSchema, nearSpecific))

    expect(decoded.nonce).toBe(nonce)
    expect(hex(decoded.blockHash)).toBe(hex(BLOCK_HASH))
    expect(decoded.gasFee).toBe(GAS_FEE_YOCTO)
  })

  it('carries nearSpecific as KeysignPayload field 16', () => {
    const bytes = toBinary(KeysignPayloadSchema, buildNearPayload())

    // Field 16, wire type 2: tag 130 = 0x82 0x01. Asserted on the wire, not on the
    // generated descriptor, so a shifted oneof field number is caught here.
    expect(Buffer.from(bytes).includes(Buffer.from([0x82, 0x01]))).toBe(true)

    const decoded = fromBinary(KeysignPayloadSchema, bytes)

    expect(decoded.blockchainSpecific.case).toBe('nearSpecific')
    if (decoded.blockchainSpecific.case !== 'nearSpecific') throw new Error('expected nearSpecific')
    expect(decoded.blockchainSpecific.value.nonce).toBe(NONCE)
    expect(decoded.blockchainSpecific.value.gasFee).toBe(GAS_FEE_YOCTO)
    expect(decoded.toAmount).toBe(DEPOSIT_YOCTO)
  })

  it('decodes a pre-change Tron payload with the reindexed descriptor', () => {
    // Bytes a pre-change client emitted: KeysignPayload.tron_specific = 14 (tag 0x72)
    // carrying TronSpecific timestamp = 1, expiration = 2, gas_estimation = 9. The
    // NEAR insertion shifted TronSpecific's descriptor *index* (14 -> 15) without
    // touching any field number, so these bytes must still decode unchanged.
    const preChangeTronPayload = '721108c0ffa7bb0610fcffa7bb0648c08db701'

    const decoded = fromBinary(KeysignPayloadSchema, Buffer.from(preChangeTronPayload, 'hex'))

    expect(decoded.blockchainSpecific.case).toBe('tronSpecific')
    if (decoded.blockchainSpecific.case !== 'tronSpecific') throw new Error('expected tronSpecific')
    expect(decoded.blockchainSpecific.value.timestamp).toBe(1735000000n)
    expect(decoded.blockchainSpecific.value.expiration).toBe(1735000060n)
    expect(decoded.blockchainSpecific.value.gasEstimation).toBe(3000000n)
  })
})
