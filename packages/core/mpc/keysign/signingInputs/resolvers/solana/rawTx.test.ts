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
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
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
import { extractSolanaMessageBytes, getSolanaSignerIndex, spliceSolanaSignature } from './rawTx'

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

const edKeyPair = (seed: number) => {
  const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(seed))
  const publicKey = privateKey.getPublicKeyEd25519()
  return {
    privateKey,
    publicKey,
    address: new SolPublicKey(new Uint8Array(publicKey.data())),
  }
}

const signMessage = (privateKey: ReturnType<typeof edKeyPair>['privateKey'], message: Uint8Array) =>
  new Uint8Array(privateKey.sign(message, walletCore.Curve.ed25519))

/**
 * The sponsored / multi-signer shape from sdk#2415: a v0 tx with three
 * required signers where the vault is signer index 1, not the fee payer.
 *
 *   staticAccountKeys[0] = relayer   fee payer, signs later (slot left zero)
 *   staticAccountKeys[1] = vault     the account we are asked to sign for
 *   staticAccountKeys[2] = cosigner  already signed
 */
function buildSponsoredV0Tx() {
  const relayer = edKeyPair(2)
  const cosigner = edKeyPair(3)
  const message = new TransactionMessage({
    payerKey: relayer.address,
    recentBlockhash: RECENT_BLOCKHASH,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: new SolPublicKey(new Uint8Array(32).fill(9)),
        lamports: 1_000_000,
      }),
      SystemProgram.transfer({
        fromPubkey: cosigner.address,
        toPubkey: new SolPublicKey(new Uint8Array(32).fill(9)),
        lamports: 1,
      }),
    ],
  }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  const cosignerSignature = signMessage(cosigner.privateKey, message.serialize())
  tx.addSignature(cosigner.address, cosignerSignature)

  expect(message.header.numRequiredSignatures).toBe(3)
  expect(message.staticAccountKeys[0].equals(relayer.address)).toBe(true)
  expect(message.staticAccountKeys[1].equals(feePayer)).toBe(true)
  expect(message.staticAccountKeys[2].equals(cosigner.address)).toBe(true)

  return { txBytes: tx.serialize(), relayer, cosigner, cosignerSignature }
}

const signatureSlot = (tx: Uint8Array, index: number) => {
  const { firstSignatureOffset } = extractSolanaMessageBytes(tx)
  return tx.slice(firstSignatureOffset + index * 64, firstSignatureOffset + (index + 1) * 64)
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

describe('getSolanaSignerIndex', () => {
  const vaultKey = () => new Uint8Array(publicKey.data())

  it('resolves the fee payer of a legacy message to slot 0', () => {
    const { message } = extractSolanaMessageBytes(buildLegacyTx())
    expect(getSolanaSignerIndex({ message, publicKey: vaultKey() })).toBe(0)
  })

  it('resolves the fee payer of a v0+ALT message to slot 0', () => {
    const { message } = extractSolanaMessageBytes(buildV0AltTx())
    expect(getSolanaSignerIndex({ message, publicKey: vaultKey() })).toBe(0)
  })

  it('resolves a non-fee-payer signer to its own slot (sdk#2415)', () => {
    const { txBytes, relayer, cosigner } = buildSponsoredV0Tx()
    const { message } = extractSolanaMessageBytes(txBytes)
    expect(
      getSolanaSignerIndex({
        message,
        publicKey: new Uint8Array(relayer.publicKey.data()),
      })
    ).toBe(0)
    expect(getSolanaSignerIndex({ message, publicKey: vaultKey() })).toBe(1)
    expect(
      getSolanaSignerIndex({
        message,
        publicKey: new Uint8Array(cosigner.publicKey.data()),
      })
    ).toBe(2)
  })

  it('rejects a key that is in the account list but not a required signer', () => {
    const { message } = extractSolanaMessageBytes(buildLegacyTx())
    // The transfer recipient is a static (writable, non-signer) account key.
    const recipient = new Uint8Array(32).fill(9)
    expect(() => getSolanaSignerIndex({ message, publicKey: recipient })).toThrow(/not a required signer/)
  })

  it('rejects a key that is not in the transaction at all', () => {
    const { message } = extractSolanaMessageBytes(buildSponsoredV0Tx().txBytes)
    expect(() => getSolanaSignerIndex({ message, publicKey: new Uint8Array(32).fill(42) })).toThrow(
      /not a required signer/
    )
  })

  it('rejects a non-32-byte public key', () => {
    const { message } = extractSolanaMessageBytes(buildLegacyTx())
    expect(() => getSolanaSignerIndex({ message, publicKey: new Uint8Array(31) })).toThrow(/32 bytes/)
  })

  it('rejects an unsupported message version', () => {
    const message = new Uint8Array([0x81, 1, 0, 0, 1, ...new Uint8Array(32)])
    expect(() => getSolanaSignerIndex({ message, publicKey: new Uint8Array(32) })).toThrow(/version 1/)
  })

  it('rejects a message whose account keys are truncated', () => {
    // Header says 1 signer, key list says 2 keys, but only one key follows.
    const message = new Uint8Array([1, 0, 1, 2, ...new Uint8Array(32)])
    expect(() => getSolanaSignerIndex({ message, publicKey: new Uint8Array(32) })).toThrow(/too short/)
  })

  it('rejects a message that requires more signatures than it lists keys for', () => {
    const message = new Uint8Array([2, 0, 0, 1, ...new Uint8Array(32)])
    expect(() => getSolanaSignerIndex({ message, publicKey: new Uint8Array(32) })).toThrow(
      /requires 2 signatures but lists 1/
    )
  })
})

describe('spliceSolanaSignature', () => {
  it('splices the fee payer into slot 0 and preserves the message', () => {
    const tx = buildLegacyTx()
    const signature = new Uint8Array(64).fill(7)

    const signed = spliceSolanaSignature({
      txData: tx,
      signature,
      publicKey: new Uint8Array(publicKey.data()),
    })

    expect(hex(signatureSlot(signed, 0))).toBe(hex(signature))
    const { firstSignatureOffset } = extractSolanaMessageBytes(tx)
    expect(hex(signed.slice(firstSignatureOffset + 64))).toBe(hex(tx.slice(firstSignatureOffset + 64)))
    // Input not mutated.
    expect(hex(signatureSlot(tx, 0))).toBe(hex(new Uint8Array(64)))
  })

  it('splices a non-fee-payer signer into its own slot and keeps the other slots (sdk#2415)', () => {
    const { txBytes, cosignerSignature } = buildSponsoredV0Tx()
    const signature = new Uint8Array(64).fill(7)

    const signed = spliceSolanaSignature({
      txData: txBytes,
      signature,
      publicKey: new Uint8Array(publicKey.data()),
    })

    // Relayer's slot is still the zero placeholder it arrived as.
    expect(hex(signatureSlot(signed, 0))).toBe(hex(new Uint8Array(64)))
    // Vault's signature landed in the vault's slot.
    expect(hex(signatureSlot(signed, 1))).toBe(hex(signature))
    // Co-signer's pre-existing signature is untouched.
    expect(hex(signatureSlot(signed, 2))).toBe(hex(cosignerSignature))
    // Message untouched.
    expect(hex(extractSolanaMessageBytes(signed).message)).toBe(hex(extractSolanaMessageBytes(txBytes).message))
    // Input not mutated.
    expect(hex(signatureSlot(txBytes, 1))).toBe(hex(new Uint8Array(64)))
  })

  it('rejects a non-64-byte signature', () => {
    const tx = buildLegacyTx()
    expect(() =>
      spliceSolanaSignature({
        txData: tx,
        signature: new Uint8Array(63),
        publicKey: new Uint8Array(publicKey.data()),
      })
    ).toThrow(/64 bytes/)
  })

  it("refuses to write into another account's slot when the key is not a signer", () => {
    const tx = buildLegacyTx()
    expect(() =>
      spliceSolanaSignature({
        txData: tx,
        signature: new Uint8Array(64),
        publicKey: new Uint8Array(32).fill(42),
      })
    ).toThrow(/not a required signer/)
  })

  it('rejects an envelope with fewer slots than the signer index', () => {
    // Message says 2 required signers (vault second), envelope declares only 1 slot.
    const { txBytes } = buildSponsoredV0Tx()
    const { firstSignatureOffset, message } = extractSolanaMessageBytes(txBytes)
    const oneSlot = new Uint8Array([1, ...txBytes.slice(firstSignatureOffset, firstSignatureOffset + 64), ...message])
    expect(() =>
      spliceSolanaSignature({
        txData: oneSlot,
        signature: new Uint8Array(64),
        publicKey: new Uint8Array(publicKey.data()),
      })
    ).toThrow(/declares 1 signature slot/)
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

        // EdDSA 'raw' format uses canonical R || S byte order end to end.
        const rawSignature = privateKey.sign(message, walletCore.Curve.ed25519)
        const signatures = {
          [hex(message)]: {
            msg: '',
            r: hex(rawSignature.slice(0, 32)),
            s: hex(rawSignature.slice(32, 64)),
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

        const output = decodeSigningOutput(Chain.Solana, compiled)
        const signedTx = base58.decode(output.encoded)

        // The signed tx is the ORIGINAL bytes with our signature in the vault's slot.
        const { firstSignatureOffset } = extractSolanaMessageBytes(txBytesList[i])
        const slotOffset =
          firstSignatureOffset +
          getSolanaSignerIndex({
            message,
            publicKey: new Uint8Array(publicKey.data()),
          }) *
            64
        const spliced = signedTx.slice(slotOffset, slotOffset + 64)
        expect(hex(new Uint8Array(signedTx.slice(0, slotOffset)))).toBe(hex(txBytesList[i].slice(0, slotOffset)))
        expect(hex(new Uint8Array(signedTx.slice(slotOffset + 64)))).toBe(hex(txBytesList[i].slice(slotOffset + 64)))

        // The spliced signature verifies over the ORIGINAL message bytes.
        expect(publicKey.verify(new Uint8Array(spliced), Buffer.from(message))).toBe(true)

        // The splice path must preserve WalletCore's SigningOutput contract:
        // downstream hash resolution reads the Solana txid from this metadata.
        const encodedSignature = base58.encode(spliced)
        expect(output.signatures).toEqual([
          {
            pubkey: feePayer.toBase58(),
            signature: encodedSignature,
          },
        ])
        expect(getTxHash({ chain: Chain.Solana, tx: output })).toBe(encodedSignature)

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

  it('sponsored v0 tx: vault at signer index 1 lands in slot 1, relayer slot stays open, co-signer kept (sdk#2415)', async () => {
    const { txBytes, relayer, cosigner, cosignerSignature } = buildSponsoredV0Tx()
    const [signedTx] = await signAndCompile([txBytes])
    const vtx = VersionedTransaction.deserialize(signedTx)
    const message = Buffer.from(vtx.message.serialize())

    expect(vtx.signatures).toHaveLength(3)
    expect(hex(vtx.signatures[0])).toBe(hex(new Uint8Array(64)))
    expect(publicKey.verify(vtx.signatures[1], message)).toBe(true)
    expect(hex(vtx.signatures[2])).toBe(hex(cosignerSignature))
    expect(cosigner.publicKey.verify(vtx.signatures[2], message)).toBe(true)

    // The relayer can still complete the transaction afterwards.
    vtx.addSignature(relayer.address, signMessage(relayer.privateKey, vtx.message.serialize()))
    expect(vtx.signatures.every(signature => signature.some(byte => byte !== 0))).toBe(true)
    expect(relayer.publicKey.verify(vtx.signatures[0], message)).toBe(true)
  })

  it('N=2 rawTransactions each sign + assemble independently (sdk#1205 shape)', async () => {
    const signed = await signAndCompile([buildLegacyTx(), buildV0AltTx()])
    expect(signed).toHaveLength(2)
    expect(Transaction.from(signed[0]).verifySignatures()).toBe(true)
    const vtx = VersionedTransaction.deserialize(signed[1])
    expect(publicKey.verify(vtx.signatures[0], Buffer.from(vtx.message.serialize()))).toBe(true)
  })
})
