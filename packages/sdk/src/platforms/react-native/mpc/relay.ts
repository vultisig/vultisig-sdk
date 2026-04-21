/**
 * Relay server client for MPC session coordination (RN-safe).
 *
 * Vendored from vultiagent-app/src/services/relay.ts with minimal changes:
 * - the hardcoded `env.relayUrl` import is replaced with a required `relayUrl`
 *   parameter on each function, so consumers inject where they get the URL.
 * - no other behavior differences.
 */

export type RelaySessionOptions = {
  relayUrl: string
  sessionId: string
  signal?: AbortSignal
}

export async function joinRelaySession(
  relayUrl: string,
  sessionId: string,
  localPartyId: string
): Promise<void> {
  const res = await fetch(`${relayUrl}/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([localPartyId]),
  })
  if (!res.ok) {
    throw new Error(`Join relay failed: ${res.status} ${await res.text()}`)
  }
}

export async function waitForParties(
  relayUrl: string,
  sessionId: string,
  expectedCount: number,
  timeoutMs = 120_000,
  signal?: AbortSignal
): Promise<string[]> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    signal?.throwIfAborted()
    const res = await fetch(`${relayUrl}/${sessionId}`, { signal })
    if (res.ok) {
      const parties: string[] = await res.json()
      if (parties.length >= expectedCount) return parties
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('Timeout waiting for parties to join relay')
}

export async function startRelaySession(
  relayUrl: string,
  sessionId: string,
  parties: string[]
): Promise<void> {
  const res = await fetch(`${relayUrl}/start/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parties),
  })
  if (!res.ok) {
    throw new Error(`Start session failed: ${res.status}`)
  }
}
