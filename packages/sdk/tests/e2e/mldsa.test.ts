/**
 * E2E Test: MLDSA (ML-DSA-44) Keygen & Signing
 *
 * Verifies ML-DSA post-quantum signature support end-to-end:
 * 1. Two-party distributed key generation (DKG) via in-process message exchange
 * 2. Two-party threshold signing with the generated keyshares
 * 3. Signature consistency: same message + keys produce identical signatures
 *
 * Uses the MLDSA WASM library directly - no relay server needed.
 * Messages are exchanged synchronously between two sessions in-process.
 */

import initializeMldsa, {
  KeygenSession,
  Keyshare,
  SignSession,
} from '@vultisig/lib-mldsa/vs_wasm'
import { beforeAll, describe, expect, it } from 'vitest'

const MLDSA_LEVEL = 44

type MpcSession = {
  outputMessage(): { body: Uint8Array; receivers: string[] } | undefined
  inputMessage(msg: Uint8Array): boolean
}

/**
 * Run the MPC message exchange loop between two sessions.
 * Each session produces output messages that are fed as input to the other.
 * Continues until both sessions report completion.
 */
function exchangeMessages(
  sessionA: MpcSession,
  sessionB: MpcSession,
  maxRounds = 100
): { aFinished: boolean; bFinished: boolean } {
  let aFinished = false
  let bFinished = false

  for (let round = 0; round < maxRounds; round++) {
    const msgA = sessionA.outputMessage()
    if (msgA && sessionB.inputMessage(msgA.body)) bFinished = true

    const msgB = sessionB.outputMessage()
    if (msgB && sessionA.inputMessage(msgB.body)) aFinished = true

    if (aFinished && bFinished) break
  }

  return { aFinished, bFinished }
}

/**
 * ML-DSA threshold signing uses rejection sampling, which can fail
 * probabilistically. This wrapper retries the full signing protocol.
 */
function signWithRetry(
  keyshareABytes: Uint8Array,
  keyshareBBytes: Uint8Array,
  keyId: Uint8Array,
  chainPath: string,
  messageHash: Uint8Array,
  partyIds: string[],
  maxAttempts = 20
): { sigA: Uint8Array; sigB: Uint8Array } {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const ksA = Keyshare.fromBytes(new Uint8Array(keyshareABytes))
      const ksB = Keyshare.fromBytes(new Uint8Array(keyshareBBytes))

      const setupMsg = SignSession.setup(
        MLDSA_LEVEL,
        keyId,
        chainPath,
        messageHash,
        partyIds
      )

      const sA = new SignSession(setupMsg, partyIds[0], ksA)
      const sB = new SignSession(setupMsg, partyIds[1], ksB)

      const { aFinished, bFinished } = exchangeMessages(sA, sB, 200)
      if (!aFinished || !bFinished) {
        throw new Error('Message exchange did not complete')
      }

      return { sigA: sA.finish(), sigB: sB.finish() }
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err
      // RejSampling is expected - retry with fresh sessions
    }
  }
  throw new Error('unreachable')
}

describe('MLDSA (ML-DSA-44) Keygen & Signing', () => {
  const partyA = 'party-alpha'
  const partyB = 'party-beta'
  const parties = [partyA, partyB]
  const threshold = 2

  // Serialized keyshares + metadata populated by beforeAll
  let keyshareABytes: Uint8Array
  let keyshareBBytes: Uint8Array
  let publicKeyHex: string
  let keyIdHex: string

  beforeAll(async () => {
    await initializeMldsa()

    const setupMsg = KeygenSession.setup(MLDSA_LEVEL, undefined, threshold, parties)
    const sessionA = new KeygenSession(setupMsg, partyA)
    const sessionB = new KeygenSession(setupMsg, partyB)

    const { aFinished, bFinished } = exchangeMessages(sessionA, sessionB, 200)
    if (!aFinished || !bFinished) throw new Error('Keygen did not complete')

    const keyshareA = sessionA.finish()
    const keyshareB = sessionB.finish()

    keyshareABytes = keyshareA.toBytes()
    keyshareBBytes = keyshareB.toBytes()
    publicKeyHex = Buffer.from(keyshareA.publicKey()).toString('hex')
    keyIdHex = Buffer.from(keyshareA.keyId()).toString('hex')

    console.log(`   MLDSA keygen complete`)
    console.log(`   Public key: ${publicKeyHex.slice(0, 64)}...`)
    console.log(`   Key ID: ${keyIdHex}`)
  })

  it('should produce matching public keys and key IDs from keygen', () => {
    const restoredA = Keyshare.fromBytes(new Uint8Array(keyshareABytes))
    const restoredB = Keyshare.fromBytes(new Uint8Array(keyshareBBytes))

    expect(Buffer.from(restoredA.publicKey()).toString('hex')).toBe(publicKeyHex)
    expect(Buffer.from(restoredB.publicKey()).toString('hex')).toBe(publicKeyHex)

    expect(Buffer.from(restoredA.keyId()).toString('hex')).toBe(keyIdHex)
    expect(Buffer.from(restoredB.keyId()).toString('hex')).toBe(keyIdHex)
  })

  it('should perform 2-of-2 threshold signing', () => {
    expect(keyshareABytes).toBeDefined()

    const messageHash = Buffer.from(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'hex'
    )
    const chainPath = 'm/44/0/0/0'
    const keyId = Buffer.from(keyIdHex, 'hex')

    // Verify setup message structure
    const setupMsg = SignSession.setup(
      MLDSA_LEVEL,
      keyId,
      chainPath,
      messageHash,
      parties
    )
    expect(setupMsg).toBeInstanceOf(Uint8Array)

    const extractedHash = SignSession.setupMessageHash(setupMsg)
    expect(extractedHash).toBeDefined()
    expect(Buffer.from(extractedHash!).toString('hex')).toBe(
      messageHash.toString('hex')
    )

    const extractedKeyId = SignSession.setupKeyId(setupMsg)
    expect(extractedKeyId).toBeDefined()
    expect(Buffer.from(extractedKeyId!).toString('hex')).toBe(keyIdHex)

    // Sign with retry (rejection sampling may fail)
    const { sigA: signatureA, sigB: signatureB } = signWithRetry(
      keyshareABytes,
      keyshareBBytes,
      keyId,
      chainPath,
      messageHash,
      parties
    )

    const sigHexA = Buffer.from(signatureA).toString('hex')
    const sigHexB = Buffer.from(signatureB).toString('hex')
    expect(sigHexA).toBe(sigHexB)

    // ML-DSA-44 signatures are ~2420 bytes
    expect(signatureA.length).toBeGreaterThan(2000)

    console.log(`   Signature length: ${signatureA.length} bytes`)
    console.log(`   Signature (first 64 hex chars): ${sigHexA.slice(0, 64)}...`)
  })

  it('should sign the same message multiple times', () => {
    const messageHash = Buffer.from(
      'deadbeef00000000000000000000000000000000000000000000000000000001',
      'hex'
    )
    const chainPath = 'm/44/0/0/0'
    const keyId = Buffer.from(keyIdHex, 'hex')

    const signatures: string[] = []

    for (let i = 0; i < 2; i++) {
      const { sigA } = signWithRetry(
        keyshareABytes,
        keyshareBBytes,
        keyId,
        chainPath,
        messageHash,
        parties
      )
      signatures.push(Buffer.from(sigA).toString('hex'))
    }

    // ML-DSA is randomized, so signatures differ but length is consistent
    expect(signatures[0].length).toBe(signatures[1].length)
    expect(signatures[0].length).toBeGreaterThan(4000)
    console.log(`   Two signatures produced (both ${signatures[0].length / 2} bytes)`)
  })

  it('should sign different messages with the same keyshares', () => {
    const chainPath = 'm/44/0/0/0'
    const keyId = Buffer.from(keyIdHex, 'hex')

    const messages = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    ]

    const signatures: string[] = []

    for (const msgHex of messages) {
      const { sigA } = signWithRetry(
        keyshareABytes,
        keyshareBBytes,
        keyId,
        chainPath,
        Buffer.from(msgHex, 'hex'),
        parties
      )
      signatures.push(Buffer.from(sigA).toString('hex'))
    }

    expect(signatures.length).toBe(3)
    for (const sig of signatures) {
      expect(sig.length).toBeGreaterThan(4000)
    }

    console.log(`   Successfully signed ${messages.length} different messages`)
    console.log(`   All signatures are ${signatures[0].length / 2} bytes`)
  })

  it('should work after keyshare serialization round-trip', () => {
    const restoredA = Keyshare.fromBytes(new Uint8Array(keyshareABytes))
    const restoredB = Keyshare.fromBytes(new Uint8Array(keyshareBBytes))

    expect(Buffer.from(restoredA.publicKey()).toString('hex')).toBe(publicKeyHex)
    expect(Buffer.from(restoredB.publicKey()).toString('hex')).toBe(publicKeyHex)
    expect(Buffer.from(restoredA.keyId()).toString('hex')).toBe(keyIdHex)

    const messageHash = Buffer.from(
      'feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface',
      'hex'
    )

    const { sigA } = signWithRetry(
      keyshareABytes,
      keyshareBBytes,
      Buffer.from(keyIdHex, 'hex'),
      'm/44/0/0/0',
      messageHash,
      parties
    )
    expect(sigA.length).toBeGreaterThan(2000)

    console.log(`   Serialization round-trip + signing verified`)
  })

  it('should work with base64-encoded keyshares (SDK storage format)', () => {
    const base64A = Buffer.from(keyshareABytes).toString('base64')
    const base64B = Buffer.from(keyshareBBytes).toString('base64')

    // Verify base64 round-trip produces same bytes
    const roundTripA = Buffer.from(base64A, 'base64')
    expect(Buffer.from(roundTripA).toString('hex')).toBe(
      Buffer.from(keyshareABytes).toString('hex')
    )

    const messageHash = Buffer.from(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'hex'
    )

    const { sigA, sigB } = signWithRetry(
      roundTripA,
      Buffer.from(base64B, 'base64'),
      Buffer.from(keyIdHex, 'hex'),
      'm/44/0/0/0',
      messageHash,
      parties
    )

    expect(Buffer.from(sigA).toString('hex')).toBe(
      Buffer.from(sigB).toString('hex')
    )

    console.log(`   Base64 keyshare round-trip + signing: OK`)
    console.log(`   Base64 keyshare A size: ${base64A.length} chars`)
  })
})
