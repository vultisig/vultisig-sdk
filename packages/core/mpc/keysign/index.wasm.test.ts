import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { ed25519 } from '@noble/curves/ed25519.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { base64Encode } from '@vultisig/lib-utils/base64Encode'
import { configureMpc, type MpcKeyshare, type MpcMessage, type MpcSession } from '@vultisig/mpc-types'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { WasmMpcEngine } from '../../../mpc-wasm/src/index'
import { getMessageHash } from '../getMessageHash'
import type { MpcRelayMessage } from '../message/relay'
import { fromMpcServerMessage, toMpcServerMessage } from '../message/server'

const relay = vi.hoisted(() => {
  const state: {
    setupMessage: Uint8Array
    clientInbox: MpcRelayMessage[]
    onClientMessage: (message: MpcRelayMessage) => void
  } = {
    setupMessage: new Uint8Array(),
    clientInbox: [],
    onClientMessage: () => {},
  }
  return state
})

vi.mock('../message/setup/ensure', () => ({
  ensureSetupMessage: async () => relay.setupMessage,
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: async (url: string, { body }: { body?: MpcRelayMessage } = {}) => {
    if (url === 'http://relay.test/message/session/client') return [...relay.clientInbox]
    if (url === 'http://relay.test/message/session' && body) return relay.onClientMessage(body)
    if (url === 'http://relay.test/complete/session/keysign') return
    throw new Error(`unexpected relay request: ${url}`)
  },
}))

const { keysign } = await import('./index')

const originalFetch = globalThis.fetch
const engine = new WasmMpcEngine()
const hexEncryptionKey = randomBytes(32).toString('hex')

type Algo = 'dkls' | 'schnorr'

const verifySignature: Record<Algo, (rs: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean> = {
  dkls: (rs, message, publicKey) => secp256k1.verify(rs, message, publicKey, { lowS: false, prehash: false }),
  schnorr: (rs, message, publicKey) => ed25519.verify(rs, message, publicKey),
}

const drainOutbound = <T>(session: MpcSession<T>) => {
  const messages: MpcMessage[] = []
  for (let message = session.outputMessage(); message; message = session.outputMessage()) {
    messages.push(message)
  }
  return messages
}

const runKeygen = async (algo: Algo, parties: string[], threshold: number) => {
  const setup = engine[algo].keygenSetup(undefined, threshold, parties)
  const sessions = new Map(
    await Promise.all(
      parties.map(async party => [party, await engine[algo].createKeygenSession(setup, party)] as const)
    )
  )
  const done = new Set<string>()
  for (let round = 0; done.size < parties.length; round++) {
    if (round > 100) throw new Error('keygen did not finish')
    for (const [, session] of sessions) {
      for (const message of drainOutbound(session)) {
        for (const receiver of message.receivers) {
          if (sessions.get(receiver)!.inputMessage(message.body)) done.add(receiver)
        }
      }
    }
  }
  const shares = new Map<string, MpcKeyshare>()
  for (const [party, session] of sessions) shares.set(party, await session.finish())
  return shares
}

// Peers answer instantly and re-feed everything they have received, like the
// relay clients, so an early message is applied in its round.
const startInstantPeers = (peerSessions: Map<string, MpcSession<Uint8Array>>) => {
  const peers = [...peerSessions.keys()]
  const finishedPeers = new Set<string>()
  const sequenceNos = new Map(peers.map(peer => [peer, 0]))
  const peerInboxes = new Map(peers.map(peer => [peer, [] as Uint8Array[]]))

  const postFrom = (peer: string) => {
    for (const { body, receivers } of drainOutbound(peerSessions.get(peer)!)) {
      for (const to of receivers) {
        if (to !== 'client') {
          peerInboxes.get(to)!.push(body)
          continue
        }
        const sequenceNo = sequenceNos.get(peer)!
        sequenceNos.set(peer, sequenceNo + 1)
        relay.clientInbox.push({
          session_id: 'session',
          from: peer,
          to: ['client'],
          body: toMpcServerMessage(body, hexEncryptionKey),
          hash: getMessageHash(base64Encode(body)),
          sequence_no: sequenceNo,
        })
      }
    }
  }
  const countQueued = () =>
    relay.clientInbox.length + [...peerInboxes.values()].reduce((total, inbox) => total + inbox.length, 0)
  const feedUnfinishedPeers = () => {
    for (const peer of peers) {
      for (const body of peerInboxes.get(peer)!) {
        if (finishedPeers.has(peer)) break
        if (peerSessions.get(peer)!.inputMessage(body)) finishedPeers.add(peer)
        postFrom(peer)
      }
    }
  }
  const runPeers = () => {
    let queuedBefore: number
    do {
      queuedBefore = countQueued()
      feedUnfinishedPeers()
    } while (countQueued() !== queuedBefore)
  }

  relay.clientInbox = []
  relay.onClientMessage = message => {
    peerInboxes.get(message.to[0])!.push(fromMpcServerMessage(message.body, hexEncryptionKey))
    runPeers()
  }
  peers.forEach(postFrom)
  runPeers()

  return finishedPeers
}

const cases = [
  {
    name: 'ECDSA 2-of-2, initiating device',
    algo: 'dkls',
    vaultParties: ['client', 'server'],
    threshold: 2,
    signers: ['client', 'server'],
    isInitiatingDevice: true,
  },
  {
    name: 'EdDSA 3 signers of 3-of-4, joining device',
    algo: 'schnorr',
    vaultParties: ['client', 'a', 'b', 'c'],
    threshold: 3,
    signers: ['client', 'a', 'b'],
    isInitiatingDevice: false,
  },
] as const

describe('keysign', () => {
  beforeAll(async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('file://') && url.endsWith('.wasm')) {
        return new Response(await readFile(fileURLToPath(url)), {
          headers: { 'Content-Type': 'application/wasm' },
        })
      }
      return originalFetch(input, init)
    }
    await engine.initialize()
    configureMpc(engine)
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it.each(cases)(
    '$name: every peer finishes when one poll returns several peer messages',
    async ({ algo, vaultParties, threshold, signers, isInitiatingDevice }) => {
      const shares = await runKeygen(algo, [...vaultParties], threshold)
      const messageHash = randomBytes(32)
      relay.setupMessage = engine[algo].signSetup(shares.get('client')!.keyId(), 'm', messageHash, [...signers])

      const peers: string[] = signers.filter(party => party !== 'client')
      const peerSessions = new Map(
        await Promise.all(
          peers.map(
            async peer =>
              [peer, await engine[algo].createSignSession(relay.setupMessage, peer, shares.get(peer)!)] as const
          )
        )
      )
      const finishedPeers = startInstantPeers(peerSessions)

      const signature = await keysign({
        keyShare: Buffer.from(shares.get('client')!.toBytes()).toString('base64'),
        signatureAlgorithm: algo === 'dkls' ? 'ecdsa' : 'eddsa',
        message: messageHash.toString('hex'),
        chainPath: 'm',
        localPartyId: 'client',
        peers,
        serverUrl: 'http://relay.test',
        sessionId: 'session',
        hexEncryptionKey,
        isInitiatingDevice,
      })

      const rs = Buffer.from(signature.r + signature.s, 'hex')
      expect(verifySignature[algo](rs, messageHash, shares.get('client')!.publicKey())).toBe(true)
      expect([...finishedPeers].sort()).toEqual([...peers].sort())
      for (const peer of peers) {
        expect(Buffer.from(await peerSessions.get(peer)!.finish()).subarray(0, 64)).toEqual(rs)
      }
    },
    60_000
  )
})
