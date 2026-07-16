/**
 * Relay server client for MPC session coordination (RN-safe).
 *
 * Vendored from vultiagent-app/src/services/relay.ts with minimal changes:
 * - the hardcoded `env.relayUrl` import is replaced with a required `relayUrl`
 *   parameter on each function, so consumers inject where they get the URL.
 * - no other behavior differences.
 */

import {
  DEFAULT_RN_FETCH_TIMEOUT_MS,
  delayWithSignal,
  FetchTimeoutError,
  throwIfSignalAborted,
  withFetchTimeout,
} from '../fetchWithTimeout'

export type RelaySessionOptions = {
  relayUrl: string
  sessionId: string
  signal?: AbortSignal
  requestTimeoutMs?: number
}

export async function joinRelaySession(
  relayUrl: string,
  sessionId: string,
  localPartyId: string,
  options: Pick<RelaySessionOptions, 'signal' | 'requestTimeoutMs'> = {}
): Promise<void> {
  await withFetchTimeout(
    `${relayUrl}/${sessionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([localPartyId]),
      signal: options.signal,
    },
    options.requestTimeoutMs ?? DEFAULT_RN_FETCH_TIMEOUT_MS,
    async res => {
      if (!res.ok) {
        throw new Error(`Join relay failed: ${res.status} ${await res.text()}`)
      }
    }
  )
}

export async function waitForParties(
  relayUrl: string,
  sessionId: string,
  expectedCount: number,
  timeoutMs = 120_000,
  signal?: AbortSignal,
  requestTimeoutMs = DEFAULT_RN_FETCH_TIMEOUT_MS
): Promise<string[]> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    throwIfSignalAborted(signal)
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - start))
    let parties: string[] | null
    try {
      parties = await withFetchTimeout(
        `${relayUrl}/${sessionId}`,
        { signal },
        Math.min(requestTimeoutMs, remainingMs),
        async res => (res.ok ? ((await res.json()) as string[]) : null)
      )
    } catch (error) {
      if (!(error instanceof FetchTimeoutError)) throw error
      continue
    }
    if (parties && parties.length >= expectedCount) return parties

    const delayMs = Math.min(1000, Math.max(0, timeoutMs - (Date.now() - start)))
    if (delayMs > 0) await delayWithSignal(delayMs, signal)
  }
  throw new Error('Timeout waiting for parties to join relay')
}

export async function startRelaySession(
  relayUrl: string,
  sessionId: string,
  parties: string[],
  options: Pick<RelaySessionOptions, 'signal' | 'requestTimeoutMs'> = {}
): Promise<void> {
  await withFetchTimeout(
    `${relayUrl}/start/${sessionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parties),
      signal: options.signal,
    },
    options.requestTimeoutMs ?? DEFAULT_RN_FETCH_TIMEOUT_MS,
    async res => {
      if (!res.ok) {
        throw new Error(`Start session failed: ${res.status}`)
      }
    }
  )
}
