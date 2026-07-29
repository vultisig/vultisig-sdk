import { Buffer } from 'buffer'

import {
  AddressLookupTableAccount,
  PublicKey as SolPublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import type { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import base58 from 'bs58'
import { beforeAll, describe, expect, it } from 'vitest'

import { CoinSchema } from '../../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { SignSolanaSchema } from '../../../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { compileTx } from '../../../../tx/compile/compileTx'
import { getPreSigningHashes } from '../../../../tx/preSigningHashes'
import { getEncodedSigningInputs } from '../../index'
import { extractSolanaMessageBytes, spliceSolanaSignature } from './rawTx'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

// Deterministic Ed25519 key — the vault / fee payer in all fixtures.
const EDDSA_PRIVATE_KEY = new Uint8Array(32).fill(1)

const RECENT_BLOCKHASH = base58.encode(new Uint8Array(32).fill(7))

let walletCore: WalletCore
let publicKey: PublicKey
let feePayer: SolPublicKey

beforeAll(async () => {
  walletCore = await initWasm()
  const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
  publicKey = privateKey.getPublicKeyEd25519()
  feePayer = new SolPublicKey(new Uint8Array(publicKey.data()))
})

/** A serialized (unsigned, zero-placeholder-sig) LEGACY transfer tx. */
function buildLegacyTx(): Uint8Array {
  const tx = new Transaction({
    recentBlockhash: RECENT_BLOCKHASH,
    feePayer,
  }).add(
    SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: new SolPublicKey(new Uint8Array(32).fill(9)),
      lamports: 1_000_000,
    })
  )
  return new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
}

/**
 * A serialized v0 tx whose transfer destination is compressed through an
 * address-lookup-table — the DEX/aggregator swap shape that made the
 * WalletCore re-encode risky (sdk#1204).
 */
function buildV0AltTx(): Uint8Array {
  const lookedUpAddress = new SolPublicKey(new Uint8Array(32).fill(9))
  const lookupTable = new AddressLookupTableAccount({
    key: new SolPublicKey(new Uint8Array(32).fill(3)),
    state: {
      deactivationSlot: BigInt('18446744073709551615'),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses: [new SolPublicKey(new Uint8Array(32).fill(8)), lookedUpAddress],
    },
  })
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: RECENT_BLOCKHASH,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: lookedUpAddress,
        lamports: 1_000_000,
      }),
    ],
  }).compileToV0Message([lookupTable])
  return new VersionedTransaction(message).serialize()
}

const buildSignSolanaPayload = (rawTransactions: string[]) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Solana,
      ticker: 'SOL',
      address: feePayer.toBase58(),
      decimals: 9,
      isNativeToken: true,
      hexPublicKey: hex(new Uint8Array(publicKey.data())),
    }),
    signData: {
      case: 'signSolana',
      value: create(SignSolanaSchema, { rawTransactions }),
    },
  })

/**
 * The PRE-#1204 pre-image derivation: decode via WalletCore, re-encode through
 * SigningInput.rawMessage, take PreSigningOutput.data. Kept here as the
 * byte-identity oracle for legacy transactions (the fix must not change what
 * gets signed for them).
 */
function oldPathPreImage(txBytes: Uint8Array): Uint8Array {
  const coinType = getCoinType({ walletCore, chain: Chain.Solana })
  const decodedData = walletCore.TransactionDecoder.decode(coinType, Buffer.from(txBytes))
  const decoded = TW.Solana.Proto.DecodingTransactionOutput.decode(decodedData)
  if (!decoded.transaction) throw new Error("Can't decode transaction")
  const txInputData = TW.Solana.Proto.SigningInput.encode(
    TW.Solana.Proto.SigningInput.create({ rawMessage: decoded.transaction })
  ).finish()
  const preOutput = TW.Solana.Proto.PreSigningOutput.decode(
    walletCore.TransactionCompiler.preImageHashes(coinType, txInputData)
  )
  return new Uint8Array(preOutput.data)
}

describe('extractSolanaMessageBytes', () => {
  it('strips a single-signature envelope', () => {
    const message = new Uint8Array([0xaa, 0xbb, 0xcc])
    const tx = new Uint8Array([1, ...new Uint8Array(64).fill(5), ...message])
    const parsed = extractSolanaMessageBytes(tx)
    expect(parsed.numSignatures).toBe(1)
    expect(parsed.firstSignatureOffset).toBe(1)
    expect(hex(parsed.message)).toBe(hex(message))
  })

  it('strips a multi-signature envelope (message after ALL slots)', () => {
    const message = new Uint8Array([0xde, 0xad])
    const tx = new Uint8Array([2, ...new Uint8Array(128).fill(6), ...message])
    const parsed = extractSolanaMessageBytes(tx)
    expect(parsed.numSignatures).toBe(2)
    expect(hex(parsed.message)).toBe(hex(message))
  })

  it('decodes a two-byte shortvec count', () => {
    // shortvec 0x80 0x01 = 128 signatures
    const numSigs = 128
    const message = new Uint8Array([0x01])
    const tx = new Uint8Array([0x80, 0x01, ...new Uint8Array(numSigs * 64), ...message])
    const parsed = extractSolanaMessageBytes(tx)
    expect(parsed.numSignatures).toBe(numSigs)
    expect(parsed.firstSignatureOffset).toBe(2)
    expect(hex(parsed.message)).toBe(hex(message))
  })

  it('rejects zero declared signatures', () => {
    expect(() => extractSolanaMessageBytes(new Uint8Array([0, 1, 2, 3]))).toThrow(/declares no signatures/)
  })

  it('rejects a truncated transaction (declared sigs run past the end)', () => {
    expect(() => extractSolanaMessageBytes(new Uint8Array([2, ...new Uint8Array(64)]))).toThrow(/too short/)
  })

  it('rejects an over-long shortvec', () => {
    expect(() => extractSolanaMessageBytes(new Uint8Array([0x80, 0x80, 0x80, 0x01]))).toThrow(/Invalid shortvec/)
  })
})

describe('spliceSolanaSignature', () => {
  it('splices into slot 0 and preserves other slots + message', () => {
    const otherSig = new Uint8Array(64).fill(2)
    const message = new Uint8Array([9, 9, 9])
    const tx = new Uint8Array([2, ...new Uint8Array(64), ...otherSig, ...message])
    const signature = new Uint8Array(64).fill(7)

    const signed = spliceSolanaSignature(tx, signature)

    expect(hex(signed.slice(1, 65))).toBe(hex(signature))
    // Second signer's placeholder untouched.
    expect(hex(signed.slice(65, 129))).toBe(hex(otherSig))
    // Message untouched.
    expect(hex(signed.slice(129))).toBe(hex(message))
    // Input not mutated.
    expect(hex(tx.slice(1, 65))).toBe(hex(new Uint8Array(64)))
  })

  it('rejects a non-64-byte signature', () => {
    const tx = new Uint8Array([1, ...new Uint8Array(64), 1])
    expect(() => spliceSolanaSignature(tx, new Uint8Array(63))).toThrow(/64 bytes/)
  })
})

describe('signSolana pre-image — byte identity (sdk#1204)', () => {
  it('LEGACY tx: new path signs the exact bytes the old WalletCore path signed (no regression)', () => {
    const txBytes = buildLegacyTx()
    const newPreImage = extractSolanaMessageBytes(txBytes).message
    const oldPreImage = oldPathPreImage(txBytes)
    expect(hex(newPreImage)).toBe(hex(oldPreImage))
  })

  it('LEGACY tx: new path signs exactly what the dApp serialized (web3.js oracle)', () => {
    const tx = Transaction.from(buildLegacyTx())
    const expected = new Uint8Array(tx.serializeMessage())
    expect(hex(extractSolanaMessageBytes(buildLegacyTx()).message)).toBe(hex(expected))
  })

  it('v0+ALT tx: new path signs exactly the message the dApp serialized (web3.js oracle)', () => {
    const txBytes = buildV0AltTx()
    const vtx = VersionedTransaction.deserialize(txBytes)
    const expected = vtx.message.serialize()
    // Identity by construction: the pre-image IS the original wire message.
    expect(hex(extractSolanaMessageBytes(txBytes).message)).toBe(hex(expected))
  })

  it('v0+ALT tx: records whether the old WalletCore re-encode diverges under this WalletCore version', () => {
    // Not asserted — divergence is WalletCore-version-sensitive (that
    // sensitivity is the whole reason ios#4419 stopped re-encoding). The new
    // path is byte-identical to the dApp message by construction either way.
    const txBytes = buildV0AltTx()
    const original = extractSolanaMessageBytes(txBytes).message
    let oldPreImage: Uint8Array | undefined
    try {
      oldPreImage = oldPathPreImage(txBytes)
    } catch {
      // WalletCore failing to round-trip the v0+ALT tx is itself the bug shape.
    }
    const diverges = !oldPreImage || hex(oldPreImage) !== hex(original)
    // eslint-disable-next-line no-console
    console.info(
      `[sdk#1204] v0+ALT WalletCore re-encode ${diverges ? 'DIVERGES from' : 'matches'} the original message under this WalletCore version`
    )
    expect(hex(original).length).toBeGreaterThan(0)
  })
})

describe('signSolana pipeline e2e (encode → hash → sign → compile)', () => {
  const signAndCompile = (txBytesList: Uint8Array[]) => {
    const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
    const keysignPayload = buildSignSolanaPayload(txBytesList.map(tx => Buffer.from(tx).toString('base64')))

    return getEncodedSigningInputs({ keysignPayload, walletCore }).then(inputs => {
      expect(inputs).toHaveLength(txBytesList.length)

      return inputs.map((txInputData, i) => {
        // txInputData is the ORIGINAL transaction, untouched.
        expect(hex(txInputData)).toBe(hex(txBytesList[i]))

        const hashes = getPreSigningHashes({
          walletCore,
          chain: Chain.Solana,
          txInputData,
          keysignPayload,
        })
        expect(hashes).toHaveLength(1)
        const [message] = hashes

        // EdDSA 'raw' format: generateSignature reverses each 32-byte half.
        const rawSignature = privateKey.sign(message, walletCore.Curve.ed25519)
        const signatures = {
          [hex(message)]: {
            msg: '',
            r: hex(new Uint8Array(rawSignature.slice(0, 32)).reverse()),
            s: hex(new Uint8Array(rawSignature.slice(32, 64)).reverse()),
            der_signature: '',
          },
        }

        const compiled = compileTx({
          publicKey,
          txInputData,
          signatures,
          chain: Chain.Solana,
          walletCore,
          keysignPayload,
        })

        const output = TW.Solana.Proto.SigningOutput.decode(compiled)
        const signedTx = base58.decode(output.encoded)

        // The signed tx is the ORIGINAL bytes with our signature in slot 0.
        const { firstSignatureOffset } = extractSolanaMessageBytes(txBytesList[i])
        const spliced = signedTx.slice(firstSignatureOffset, firstSignatureOffset + 64)
        expect(hex(new Uint8Array(signedTx.slice(0, firstSignatureOffset)))).toBe(
          hex(txBytesList[i].slice(0, firstSignatureOffset))
        )
        expect(hex(new Uint8Array(signedTx.slice(firstSignatureOffset + 64)))).toBe(
          hex(txBytesList[i].slice(firstSignatureOffset + 64))
        )

        // The spliced signature verifies over the ORIGINAL message bytes.
        expect(publicKey.verify(new Uint8Array(spliced), Buffer.from(message))).toBe(true)

        return new Uint8Array(signedTx)
      })
    })
  }

  it('legacy tx round-trips and web3.js accepts the signed result', async () => {
    const [signedTx] = await signAndCompile([buildLegacyTx()])
    const decoded = Transaction.from(signedTx)
    expect(decoded.verifySignatures()).toBe(true)
  })

  it('v0+ALT tx round-trips and web3.js verifies the fee-payer signature', async () => {
    const [signedTx] = await signAndCompile([buildV0AltTx()])
    const vtx = VersionedTransaction.deserialize(signedTx)
    expect(vtx.signatures).toHaveLength(1)
    expect(publicKey.verify(vtx.signatures[0], Buffer.from(vtx.message.serialize()))).toBe(true)
  })

  it('N=2 rawTransactions each sign + assemble independently (sdk#1205 shape)', async () => {
    const signed = await signAndCompile([buildLegacyTx(), buildV0AltTx()])
    expect(signed).toHaveLength(2)
    expect(Transaction.from(signed[0]).verifySignatures()).toBe(true)
    const vtx = VersionedTransaction.deserialize(signed[1])
    expect(publicKey.verify(vtx.signatures[0], Buffer.from(vtx.message.serialize()))).toBe(true)
  })
})
