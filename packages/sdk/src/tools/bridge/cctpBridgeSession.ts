import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import type { PublicClient } from 'viem'

import type { CctpChainConfig } from './cctp'

const sessionBrand: unique symbol = Symbol('CctpBridgeSession')

/** Opaque cache scope created by {@link createCctpBridgeSession}. */
export type CctpBridgeSession = { readonly [sessionBrand]: true }

type CodeCheck = { client: PublicClient; promise: Promise<void> }
const sessions = new WeakMap<CctpBridgeSession, Map<string, CodeCheck>>()
const CODE_CHECK_TIMEOUT_MS = 20_000

/**
 * Start a CCTP route-building session. Reuse this handle for related quotes;
 * discard it when the wallet/quote session ends. A new handle starts uncached.
 * Only successful checks are reused, keyed by canonical chain and transmitter
 * address. Changing the configured RPC client forces a fresh check. Concurrent
 * builds share an in-flight check; failures (including timeout) can be retried.
 * Omitting the handle from buildCctpBridge checks the destination on every call.
 */
export const createCctpBridgeSession = (): CctpBridgeSession => {
  const session: CctpBridgeSession = Object.freeze({ [sessionBrand]: true })
  sessions.set(session, new Map())
  return session
}

/** No unsigned approve/burn envelope was returned for this unavailable route. */
export class CctpRouteUnavailableError extends Error {
  constructor(chain: string, address: string, reason: string, cause?: unknown) {
    super(`CCTP route unavailable: ${chain} MessageTransmitter ${address}: ${reason}`, { cause })
    this.name = 'CctpRouteUnavailableError'
  }
}

const checkCode = async (destination: CctpChainConfig, client: PublicClient): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Use a plain timer rather than AbortSignal.timeout, which Hermes lacks.
    // The race bounds the entire operation, including transport retries. Late
    // RPC results cannot turn a timed-out check into a cached success.
    const code = await Promise.race([
      client.getCode({ address: destination.messageTransmitter }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('code check timed out after 20000ms')), CODE_CHECK_TIMEOUT_MS)
      }),
    ])
    if (!code || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
      throw new CctpRouteUnavailableError(destination.chain, destination.messageTransmitter, 'no contract code')
    }
  } catch (cause) {
    if (cause instanceof CctpRouteUnavailableError) throw cause
    throw new CctpRouteUnavailableError(
      destination.chain,
      destination.messageTransmitter,
      'contract code could not be verified (RPC failure or timeout)',
      cause
    )
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// Internal: every public burn builder must await this before encoding calldata.
export const validateCctpMintSide = async (
  destination: CctpChainConfig,
  session?: CctpBridgeSession
): Promise<void> => {
  const cache = session === undefined ? undefined : sessions.get(session)
  if (session !== undefined && !cache) {
    throw new CctpRouteUnavailableError(destination.chain, destination.messageTransmitter, 'invalid bridge session')
  }
  let client: PublicClient
  try {
    client = getEvmClient(destination.chain)
  } catch (cause) {
    throw new CctpRouteUnavailableError(
      destination.chain,
      destination.messageTransmitter,
      'RPC client unavailable',
      cause
    )
  }
  const key = `${destination.chain}:${destination.messageTransmitter.toLowerCase()}`
  const cached = cache?.get(key)
  if (cached?.client === client) return cached.promise

  const promise = checkCode(destination, client)
  const entry = { client, promise }
  cache?.set(key, entry)
  try {
    await promise
  } catch (cause) {
    if (cache?.get(key) === entry) cache.delete(key)
    throw cause
  }
}
