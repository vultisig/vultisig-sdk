import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { ed25519 } from '@noble/curves/ed25519.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { initWasm } from '@trustwallet/wallet-core'
import type { MpcKeyshare, MpcPerAlgorithmEngineBase, MpcSession } from '@vultisig/mpc-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateSignature } from '../../core/mpc/tx/signature/generateSignature'
import { formatSignature } from '../../sdk/src/adapters/formatSignature'
import { WasmMpcEngine } from './index'

const originalFetch = globalThis.fetch

const installWasmFileFetch = () => {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    if (url.startsWith('file://') && url.endsWith('.wasm')) {
      const bytes = await readFile(fileURLToPath(url))
      return new Response(bytes, {
        headers: { 'Content-Type': 'application/wasm' },
      })
    }

    return originalFetch(input, init)
  }
}

type SessionFactory<TResult> = (partyId: string) => MpcSession<TResult> | Promise<MpcSession<TResult>>

const createSessions = async <TResult>(partyIds: string[], factory: SessionFactory<TResult>) =>
  new Map(await Promise.all(partyIds.map(async partyId => [partyId, await factory(partyId)] as const)))

const runProtocol = async <TResult>(sessions: Map<string, MpcSession<TResult>>): Promise<Map<string, TResult>> => {
  const completed = new Set<string>()

  try {
    for (let round = 0; round < 1_000; round++) {
      let deliveredMessages = 0

      for (const [sender, session] of sessions) {
        for (let message = session.outputMessage(); message; message = session.outputMessage()) {
          expect(message.receivers.length, `${sender} emitted a message without receivers`).toBeGreaterThan(0)

          for (const receiver of message.receivers) {
            const recipient = sessions.get(receiver)
            if (!recipient) throw new Error(`${sender} emitted a message for unknown party ${receiver}`)
            if (completed.has(receiver)) continue

            deliveredMessages++
            if (recipient.inputMessage(message.body.slice())) completed.add(receiver)
          }
        }
      }

      if (completed.size === sessions.size) {
        return new Map(
          await Promise.all([...sessions].map(async ([partyId, session]) => [partyId, await session.finish()] as const))
        )
      }

      if (deliveredMessages === 0) {
        throw new Error(
          `MPC protocol stalled after ${round + 1} rounds; completed ${completed.size}/${sessions.size} parties`
        )
      }
    }

    throw new Error(`MPC protocol exceeded the 1,000-round safety limit`)
  } finally {
    sessions.forEach(session => session.free?.())
  }
}

const expectSharedKey = (shares: Map<string, MpcKeyshare>) => {
  const publicKeys = [...shares.values()].map(share => Buffer.from(share.publicKey()).toString('hex'))
  const keyIds = [...shares.values()].map(share => Buffer.from(share.keyId()).toString('hex'))

  expect(new Set(publicKeys)).toHaveLength(1)
  expect(new Set(keyIds)).toHaveLength(1)
  expect(publicKeys[0]).toBeTruthy()
  expect(keyIds[0]).toBeTruthy()
}

type AlgorithmCase = {
  name: string
  select: (engine: WasmMpcEngine) => MpcPerAlgorithmEngineBase
  signatureLength: number
  verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean
}

const cases: AlgorithmCase[] = [
  {
    name: 'DKLS/ECDSA',
    select: engine => engine.dkls,
    signatureLength: 65,
    verify: (signature, message, publicKey) => {
      if (signature.length !== 65) return false

      const recoverableSignature = new Uint8Array(65)
      recoverableSignature[0] = signature[64]!
      recoverableSignature.set(signature.subarray(0, 64), 1)
      const recoveredPublicKey = secp256k1.recoverPublicKey(recoverableSignature, message, { prehash: false })

      return (
        secp256k1.verify(signature.subarray(0, 64), message, publicKey, { lowS: false, prehash: false }) &&
        Buffer.from(recoveredPublicKey).equals(Buffer.from(publicKey))
      )
    },
  },
  {
    name: 'Schnorr/EdDSA',
    select: engine => engine.schnorr,
    signatureLength: 64,
    verify: (signature, message, publicKey) => ed25519.verify(signature, message, publicKey),
  },
]

describe.each(cases)('$name real WASM MPC ceremonies', ({ name, select, signatureLength, verify }) => {
  const engine = new WasmMpcEngine()
  const originalParties = ['alice', 'bob', 'carol']
  const resharedParties = ['bob', 'carol', 'dave']
  const allParties = ['alice', 'bob', 'carol', 'dave']
  const message = sha256(new TextEncoder().encode('vultisig real WASM MPC regression'))

  beforeAll(async () => {
    installWasmFileFetch()
    await engine.initialize()
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('completes keygen, keysign, reshare, and post-reshare keysign in process', async () => {
    const algorithm = select(engine)
    const keygenSetup = algorithm.keygenSetup(undefined, 2, originalParties)
    const originalShares = await runProtocol(
      await createSessions(originalParties, partyId => algorithm.createKeygenSession(keygenSetup, partyId))
    )

    expectSharedKey(originalShares)

    const signers = ['alice', 'bob']
    const signSetup = algorithm.signSetup(originalShares.get('alice')!.keyId(), 'm', message, signers)
    expect(algorithm.signSetupMessageHash(signSetup)).toEqual(message)
    expect(algorithm.signSetupKeyId(signSetup)).toEqual(originalShares.get('alice')!.keyId())

    const signatures = await runProtocol(
      await createSessions(signers, partyId =>
        algorithm.createSignSession(signSetup, partyId, originalShares.get(partyId)!)
      )
    )
    const signature = signatures.get('alice')!

    expect(signature).toHaveLength(signatureLength)
    expect(signatures.get('bob')).toEqual(signature)
    expect(verify(signature, message, originalShares.get('alice')!.publicKey())).toBe(true)

    if (name === 'Schnorr/EdDSA') {
      const messageKey = bytesToHex(message)
      const keysignSignature = {
        msg: messageKey,
        r: bytesToHex(signature.subarray(0, 32)),
        s: bytesToHex(signature.subarray(32, 64)),
        der_signature: '',
      }
      const sdkSignature = hexToBytes(
        formatSignature({ [messageKey]: keysignSignature }, [messageKey], 'eddsa').signature
      )
      const coreSignature = generateSignature({
        walletCore: await initWasm(),
        signature: keysignSignature,
        signatureFormat: 'raw',
      })

      expect(ed25519.verify(sdkSignature, message, originalShares.get('alice')!.publicKey())).toBe(true)
      expect(ed25519.verify(coreSignature, message, originalShares.get('alice')!.publicKey())).toBe(true)
      expect(coreSignature).toEqual(sdkSignature)
      expect(coreSignature).toEqual(signature)
    }

    const reshareSetup = algorithm.reshareSetup(
      originalShares.get('alice')!,
      allParties,
      new Uint8Array([0, 1, 2]),
      2,
      new Uint8Array([1, 2, 3])
    )
    const reshareResults = await runProtocol(
      await createSessions(allParties, partyId =>
        algorithm.createReshareSession(reshareSetup, partyId, originalShares.get(partyId) ?? null)
      )
    )

    expect(reshareResults.get('alice')).toBeUndefined()
    const resharedShares = new Map(resharedParties.map(partyId => [partyId, reshareResults.get(partyId)!] as const))
    expectSharedKey(resharedShares)
    expect(resharedShares.get('dave')!.publicKey()).toEqual(originalShares.get('alice')!.publicKey())

    const resharedSigners = ['bob', 'dave']
    const resharedSignSetup = algorithm.signSetup(resharedShares.get('bob')!.keyId(), 'm', message, resharedSigners)
    const resharedSignatures = await runProtocol(
      await createSessions(resharedSigners, partyId =>
        algorithm.createSignSession(resharedSignSetup, partyId, resharedShares.get(partyId)!)
      )
    )
    const resharedSignature = resharedSignatures.get('bob')!

    expect(resharedSignature).toHaveLength(signatureLength)
    expect(resharedSignatures.get('dave')).toEqual(resharedSignature)
    expect(verify(resharedSignature, message, resharedShares.get('bob')!.publicKey())).toBe(true)

    originalShares.forEach(share => share.free?.())
    resharedShares.forEach(share => share.free?.())
  }, 60_000)
})
