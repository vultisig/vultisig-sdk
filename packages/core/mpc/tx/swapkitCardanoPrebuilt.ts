import { blake2b } from '@noble/hashes/blake2.js'
import { Chain } from '@vultisig/core-chain/Chain'
import { buildCardanoWitnessSet } from '@vultisig/core-chain/chains/cardano/cip30/buildCardanoWitnessSet'
import { concat } from '@vultisig/core-chain/chains/cardano/cip30/cardanoCborPrimitives'
import { cborSkip } from '@vultisig/core-chain/chains/cardano/cip30/cborSkip'

import { KeysignPayload } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayload } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'

/**
 * SwapKit's pre-built Cardano route (`tx_type = "CARDANO_PREBUILT"`).
 *
 * SwapKit selects the UTXOs, splits the change and prices the fee server-side,
 * and the initiator relays the unsigned transaction in `tx_payload` as the raw
 * CBOR envelope `[body, witness_set, is_valid, auxiliary_data]`. Every device
 * signs blake2b-256 of the body bytes exactly as received: rebuilding the
 * transaction through WalletCore yields a different body, so a different
 * digest, and the ceremony never converges. After signing, the vault's vkey
 * witness replaces item 1 while items 0, 2 and 3 are re-emitted byte for byte —
 * re-encoding could change integer widths or map order and void the signature.
 *
 * Distinct from the deposit-only `"CARDANO"` type, whose `tx_payload` is empty
 * and which signs a plain ADA send rebuilt from the keysign payload.
 *
 * Mirrors iOS `SwapKitCardanoSigner.swift` and Android `SwapKitCardanoSigner.kt`.
 */
const swapKitCardanoPrebuiltTxType = 'CARDANO_PREBUILT'

/** The SwapKit payload of a keysign carrying a pre-built Cardano transaction, or `undefined` for any other route. */
export const getSwapKitCardanoPrebuiltPayload = (keysignPayload: KeysignPayload): SwapKitSwapPayload | undefined => {
  if (keysignPayload.coin?.chain !== Chain.Cardano || keysignPayload.swapPayload.case !== 'swapkitSwapPayload') {
    return undefined
  }

  const swapKitPayload = keysignPayload.swapPayload.value
  return swapKitPayload.txType.toUpperCase() === swapKitCardanoPrebuiltTxType ? swapKitPayload : undefined
}

type CardanoEnvelope = {
  body: Uint8Array
  isValid: Uint8Array
  auxData: Uint8Array
}

/** CBOR header of a definite-length 4-item array. */
const envelopeHeader = 0x84

/**
 * Slices the envelope into the items that are hashed and re-emitted. The
 * witness set is measured but dropped: the signed transaction carries only
 * this vault's witness.
 */
const parseCardanoEnvelope = (envelope: Uint8Array): CardanoEnvelope => {
  if (envelope.length === 0) {
    throw new Error('SwapKit Cardano transaction payload is empty.')
  }
  if (envelope[0] !== envelopeHeader) {
    throw new Error(
      `SwapKit Cardano transaction must be a 4-item CBOR array (0x84), but starts with 0x${envelope[0].toString(16)}.`
    )
  }

  const bodyStart = 1
  const bodyEnd = cborSkip(envelope, bodyStart)
  const witnessSetEnd = cborSkip(envelope, bodyEnd)
  const isValidEnd = cborSkip(envelope, witnessSetEnd)
  const auxDataEnd = cborSkip(envelope, isValidEnd)

  if (auxDataEnd !== envelope.length) {
    throw new Error(
      `SwapKit Cardano transaction has ${envelope.length - auxDataEnd} trailing bytes after its 4 envelope items.`
    )
  }

  return {
    body: envelope.subarray(bodyStart, bodyEnd),
    isValid: envelope.subarray(witnessSetEnd, isValidEnd),
    auxData: envelope.subarray(isValidEnd, auxDataEnd),
  }
}

const cborMajorType = { uint: 0, bytes: 2, array: 4, map: 5 } as const

type CborMajorType = (typeof cborMajorType)[keyof typeof cborMajorType]

/** Byte length of the argument that follows a CBOR head, by additional-info value. */
const cborArgumentLengths = new Map([
  [24, 1],
  [25, 2],
  [26, 4],
  [27, 8],
])

const truncatedBodyError = () => new Error('SwapKit Cardano transaction body is truncated.')

/**
 * Sequential value reader over the definite-length CBOR of a transaction
 * body. `cborSkip` only measures items; validating the body needs their
 * values. A leading tag 258 ("set", which Conway-era encoders may wrap a
 * collection in) is unwrapped before every read, as nothing here depends on it.
 */
const createCborReader = (data: Uint8Array) => {
  let offset = 0

  const skipSetTag = () => {
    if (data[offset] === 0xd9 && data[offset + 1] === 0x01 && data[offset + 2] === 0x02) {
      offset += 3
    }
  }

  const peekMajorType = (): number => {
    skipSetTag()
    if (offset >= data.length) {
      throw truncatedBodyError()
    }

    return data[offset] >> 5
  }

  const readHead = (expected: CborMajorType): bigint => {
    const majorType = peekMajorType()
    if (majorType !== expected) {
      throw new Error(
        `SwapKit Cardano transaction body has CBOR major type ${majorType} where ${expected} was expected.`
      )
    }

    const additionalInfo = data[offset] & 0x1f
    offset += 1
    if (additionalInfo < 24) {
      return BigInt(additionalInfo)
    }

    const argumentLength = cborArgumentLengths.get(additionalInfo)
    if (argumentLength === undefined) {
      throw new Error('SwapKit Cardano transaction body uses indefinite-length or reserved CBOR.')
    }
    if (offset + argumentLength > data.length) {
      throw truncatedBodyError()
    }

    let value = 0n
    for (let index = 0; index < argumentLength; index++) {
      value = (value << 8n) | BigInt(data[offset + index])
    }
    offset += argumentLength

    return value
  }

  // Every counted element takes at least one byte, so a count beyond the
  // buffer is truncation — and bounding it here keeps it a safe integer.
  const readCount = (expected: CborMajorType): number => {
    const count = readHead(expected)
    if (count > BigInt(data.length)) {
      throw truncatedBodyError()
    }

    return Number(count)
  }

  return {
    peekMajorType,
    readUint: () => readHead(cborMajorType.uint),
    readArraySize: () => readCount(cborMajorType.array),
    readMapSize: () => readCount(cborMajorType.map),
    readBytes: (): Uint8Array => {
      const length = readCount(cborMajorType.bytes)
      if (length > data.length - offset) {
        throw truncatedBodyError()
      }

      const bytes = data.subarray(offset, offset + length)
      offset += length

      return bytes
    },
    skip: () => {
      offset = cborSkip(data, offset)
    },
    isAtEnd: () => offset === data.length,
  }
}

type CborReader = ReturnType<typeof createCborReader>

type CardanoOutputValue = {
  lovelace: bigint
  /** Whether native tokens ride along with the ADA. */
  hasAssets: boolean
}

type CardanoOutput = CardanoOutputValue & {
  address: Uint8Array
  /** Whether the output carries anything beyond an address and a value (datum, script reference). */
  hasExtras: boolean
}

/** `coin` or `[coin, multiasset]`. */
const readOutputValue = (reader: CborReader): CardanoOutputValue => {
  if (reader.peekMajorType() === cborMajorType.uint) {
    return { lovelace: reader.readUint(), hasAssets: false }
  }

  if (reader.readArraySize() !== 2) {
    throw new Error('SwapKit Cardano output value is malformed.')
  }

  const lovelace = reader.readUint()
  reader.skip()

  return { lovelace, hasAssets: true }
}

const outputAddressKey = 0n
const outputValueKey = 1n

/** Legacy `[address, value, datum_hash?]` or post-Alonzo `{0: address, 1: value, 2: datum, 3: script_ref}`. */
const readOutput = (reader: CborReader): CardanoOutput => {
  const majorType = reader.peekMajorType()

  if (majorType === cborMajorType.array) {
    const size = reader.readArraySize()
    if (size < 2) {
      throw new Error('SwapKit Cardano output is truncated.')
    }

    const address = reader.readBytes()
    const value = readOutputValue(reader)
    for (let index = 2; index < size; index++) {
      reader.skip()
    }

    return { address, ...value, hasExtras: size > 2 }
  }

  if (majorType === cborMajorType.map) {
    let address: Uint8Array | undefined
    let value: CardanoOutputValue | undefined
    let hasExtras = false

    const size = reader.readMapSize()
    for (let index = 0; index < size; index++) {
      const key = reader.readUint()

      // A repeated address or value would leave it open which copy the ledger honours.
      if (key === outputAddressKey) {
        if (address) {
          throw new Error('SwapKit Cardano output repeats its address.')
        }
        address = reader.readBytes()
      } else if (key === outputValueKey) {
        if (value) {
          throw new Error('SwapKit Cardano output repeats its value.')
        }
        value = readOutputValue(reader)
      } else {
        hasExtras = true
        reader.skip()
      }
    }

    if (!address) {
      throw new Error('SwapKit Cardano output has no address.')
    }
    if (!value) {
      throw new Error('SwapKit Cardano output has no value.')
    }

    return { address, ...value, hasExtras }
  }

  throw new Error('SwapKit Cardano output is neither an array nor a map.')
}

const areEqualBytes = (one: Uint8Array, another: Uint8Array): boolean =>
  one.length === another.length && one.every((byte, index) => byte === another[index])

type VerifyOutputsInput = {
  reader: CborReader
  vaultAddress: Uint8Array
  fromAmount: bigint
}

const verifyOutputs = ({ reader, vaultAddress, fromAmount }: VerifyOutputsInput): void => {
  let deposits = 0

  const count = reader.readArraySize()
  for (let index = 0; index < count; index++) {
    const output = readOutput(reader)
    if (areEqualBytes(output.address, vaultAddress)) {
      continue
    }

    deposits += 1
    if (deposits > 1) {
      throw new Error('SwapKit Cardano transaction pays more than one output outside this vault.')
    }
    if (output.hasAssets || output.hasExtras) {
      throw new Error(`SwapKit Cardano deposit output #${index} must carry plain ADA only.`)
    }
    if (output.lovelace > fromAmount) {
      throw new Error(
        `SwapKit Cardano deposit of ${output.lovelace} lovelace exceeds the quoted swap amount of ${fromAmount}.`
      )
    }
  }
}

const cardanoPublicKeyLength = 32
const cardanoSignatureLength = 64

/** `0x61 ‖ blake2b-224(vkey)`: the mainnet enterprise address Vultisig derives for Cardano. */
const getVaultEnterpriseAddress = (vaultPublicKey: Uint8Array): Uint8Array => {
  if (vaultPublicKey.length !== cardanoPublicKeyLength) {
    throw new Error(`Cardano vault key must be ${cardanoPublicKeyLength} bytes, got ${vaultPublicKey.length}.`)
  }

  return concat([Uint8Array.of(0x61), blake2b(vaultPublicKey, { dkLen: 28 })])
}

const bodyOutputsKey = 1n
const bodyFeeKey = 2n

/**
 * Body fields a plain payment may carry besides outputs (1) and fee (2):
 * inputs (0), ttl (3), auxiliary-data hash (7), validity start (8) and
 * network id (15).
 */
const passiveBodyKeys: ReadonlySet<bigint> = new Set([0n, 3n, 7n, 8n, 15n])

/**
 * A plain Cardano payment's fee is `a + b·size`. At mainnet's current
 * parameters (0.155381 ADA + 44 lovelace/byte) even a maximum-size 16 KiB
 * transaction costs about 0.88 ADA.
 */
const maxFeeLovelace = 2_000_000n

type VerifySwapKitCardanoBodyInput = {
  body: Uint8Array
  /** The quoted swap amount in lovelace, which bounds the deposit. */
  fromAmount: bigint
  /** This vault's own 32-byte Ed25519 key — never one read off the keysign payload. */
  vaultPublicKey: Uint8Array
}

/**
 * Refuses a transaction body the displayed quote does not imply.
 *
 * No Verify screen reads the body, so it must be a plain payment out of this
 * vault: every output pays back to the vault except a single ADA-only deposit
 * of at most `fromAmount`, and the fee is bounded. Fields a plain payment never
 * carries (certificates, withdrawals, minting, collateral, required signers,
 * governance) are refused. The deposit address is not pinned, because
 * SwapKit's on-chain deposit address differs from its declared `targetAddress`.
 *
 * Same rule set as Android's and iOS's `verifyBody`, plus a refusal of
 * repeated fields.
 */
export const verifySwapKitCardanoBody = ({ body, fromAmount, vaultPublicKey }: VerifySwapKitCardanoBodyInput): void => {
  const vaultAddress = getVaultEnterpriseAddress(vaultPublicKey)
  const reader = createCborReader(body)
  const seenKeys = new Set<bigint>()
  let fee: bigint | undefined

  const fieldCount = reader.readMapSize()
  for (let index = 0; index < fieldCount; index++) {
    const key = reader.readUint()
    if (seenKeys.has(key)) {
      throw new Error(`SwapKit Cardano transaction body repeats field ${key}.`)
    }
    seenKeys.add(key)

    if (key === bodyOutputsKey) {
      verifyOutputs({ reader, vaultAddress, fromAmount })
    } else if (key === bodyFeeKey) {
      fee = reader.readUint()
    } else if (passiveBodyKeys.has(key)) {
      reader.skip()
    } else {
      throw new Error(
        `SwapKit Cardano transaction body carries field ${key}, which a plain payment never uses; refusing to sign.`
      )
    }
  }

  if (!reader.isAtEnd()) {
    throw new Error('SwapKit Cardano transaction body has trailing bytes.')
  }
  if (!seenKeys.has(bodyOutputsKey)) {
    throw new Error('SwapKit Cardano transaction body has no outputs.')
  }
  if (fee === undefined) {
    throw new Error('SwapKit Cardano transaction body has no fee.')
  }
  if (fee > maxFeeLovelace) {
    throw new Error(`SwapKit Cardano fee of ${fee} lovelace exceeds the ${maxFeeLovelace} ceiling.`)
  }
}

/**
 * The quoted amount the deposit is bounded by, in lovelace. The bound only
 * means something when the swap's source asset is ADA itself: a token amount
 * is not a lovelace amount, and a deposit must be plain ADA regardless.
 */
const getQuotedLovelace = ({ fromCoin, fromAmount }: SwapKitSwapPayload): bigint => {
  if (fromCoin?.chain !== Chain.Cardano || fromCoin.contractAddress !== '') {
    throw new Error('SwapKit Cardano pre-built transactions can only swap from ADA.')
  }
  if (!/^\d+$/.test(fromAmount)) {
    throw new Error(`SwapKit Cardano swap amount is invalid: ${fromAmount}`)
  }

  return BigInt(fromAmount)
}

type VerifiedEnvelopeInput = {
  envelope: Uint8Array
  swapKitPayload: SwapKitSwapPayload
  vaultPublicKey: Uint8Array
}

const getVerifiedEnvelope = ({ envelope, swapKitPayload, vaultPublicKey }: VerifiedEnvelopeInput): CardanoEnvelope => {
  const parsed = parseCardanoEnvelope(envelope)
  verifySwapKitCardanoBody({
    body: parsed.body,
    fromAmount: getQuotedLovelace(swapKitPayload),
    vaultPublicKey,
  })

  return parsed
}

type GetSwapKitCardanoPrebuiltSigningInputInput = {
  swapKitPayload: SwapKitSwapPayload
  /** This vault's own 32-byte Ed25519 key — never one read off the keysign payload. */
  vaultPublicKey: Uint8Array
}

/**
 * The signing input of a pre-built Cardano swap: SwapKit's unsigned envelope,
 * byte for byte. The body is validated first, so a transaction that fails
 * validation never produces a hash to sign.
 */
export const getSwapKitCardanoPrebuiltSigningInput = ({
  swapKitPayload,
  vaultPublicKey,
}: GetSwapKitCardanoPrebuiltSigningInputInput): Uint8Array => {
  const envelope = swapKitPayload.txPayload
  getVerifiedEnvelope({ envelope, swapKitPayload, vaultPublicKey })

  return envelope
}

/**
 * The single digest a Cardano transaction needs signed, which is also its
 * transaction id: blake2b-256 of the envelope's body bytes. Expects the
 * envelope `getSwapKitCardanoPrebuiltSigningInput` already validated.
 */
export const getSwapKitCardanoPrebuiltPreSigningHash = (envelope: Uint8Array): Uint8Array =>
  blake2b(parseCardanoEnvelope(envelope).body, { dkLen: 32 })

type BuildSignedSwapKitCardanoTxInput = VerifiedEnvelopeInput & {
  /** 64-byte Ed25519 signature over the body hash. */
  signature: Uint8Array
}

/**
 * Assembles the broadcastable transaction: the envelope with its witness set
 * replaced by `{ 0: [[vkey, signature]] }` and every other item untouched.
 * The body is validated again, so nothing reaches the network on the strength
 * of an earlier check alone.
 */
export const buildSignedSwapKitCardanoTx = ({
  envelope,
  swapKitPayload,
  vaultPublicKey,
  signature,
}: BuildSignedSwapKitCardanoTxInput): Uint8Array => {
  const { body, isValid, auxData } = getVerifiedEnvelope({ envelope, swapKitPayload, vaultPublicKey })

  if (signature.length !== cardanoSignatureLength) {
    throw new Error(`Cardano signature must be ${cardanoSignatureLength} bytes, got ${signature.length}.`)
  }

  return concat([
    Uint8Array.of(envelopeHeader),
    body,
    buildCardanoWitnessSet({ publicKey: vaultPublicKey, signature }),
    isValid,
    auxData,
  ])
}
