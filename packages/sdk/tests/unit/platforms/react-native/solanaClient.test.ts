import { describe, expect, it, vi } from 'vitest'

// The Solana + Sui lazy-client proxies are the RN runtime's answer to
// `@solana/web3.js` and `@mysten/sui` pulling Node-only top-level imports
// (`ws`, `Intl.PluralRules`) that Hermes can't satisfy. The proxy must
// short-circuit for non-method property accesses — otherwise:
//   const c = getSolanaClient();  await c  // would call `c.then`, and since
// the proxy returns a function for every access, `.then` becomes a function
// → Promise sees a thenable → calls it → passes resolve/reject → the function
// lazy-loads `@solana/web3.js`, which in the Node/jsdom test env triggers a
// real `ws` import and hangs / crashes. This regression test guards the fix.

vi.mock('@vultisig/core-config', () => ({
  rootApiUrl: 'https://api.vultisig.com',
}))

const { getSolanaClient } = await import('../../../../src/platforms/react-native/overrides/solanaClient')
const { getSuiClient } = await import('../../../../src/platforms/react-native/overrides/suiClient')

describe('RN solanaClient / suiClient lazy Proxy — thenable hazard guards', () => {
  it('solanaClient proxy does not expose a .then property (would make proxy thenable)', () => {
    const client = getSolanaClient()
    expect((client as unknown as { then?: unknown }).then).toBeUndefined()
  })

  it('solanaClient proxy returns undefined for toJSON / catch / valueOf', () => {
    const client = getSolanaClient() as unknown as Record<string, unknown>
    expect(client.then).toBeUndefined()
    expect(client.catch).toBeUndefined()
    expect(client.finally).toBeUndefined()
    expect(client.toJSON).toBeUndefined()
  })

  it('solanaClient proxy returns undefined for symbol probes', () => {
    const client = getSolanaClient() as unknown as Record<string | symbol, unknown>
    expect(client[Symbol.toPrimitive]).toBeUndefined()
    expect(client[Symbol.iterator]).toBeUndefined()
    expect(client[Symbol.toStringTag]).toBeUndefined()
  })

  it('Promise.resolve(solanaClient) does NOT treat proxy as thenable', async () => {
    const client = getSolanaClient()
    // If `.then` returned a function, Promise.resolve would call it and hang.
    // With the guard, the proxy is opaque and Promise wraps it verbatim.
    const wrapped = await Promise.resolve(client)
    expect(wrapped).toBe(client)
  })

  it('suiClient proxy does not expose a .then property', () => {
    const client = getSuiClient()
    expect((client as unknown as { then?: unknown }).then).toBeUndefined()
  })

  it('suiClient proxy returns undefined for symbol probes', () => {
    const client = getSuiClient() as unknown as Record<string | symbol, unknown>
    expect(client[Symbol.toPrimitive]).toBeUndefined()
    expect(client[Symbol.iterator]).toBeUndefined()
  })

  it('Promise.resolve(suiClient) does NOT treat proxy as thenable', async () => {
    const client = getSuiClient()
    const wrapped = await Promise.resolve(client)
    expect(wrapped).toBe(client)
  })

  it('regular method access still returns a callable wrapper (not short-circuited)', () => {
    const client = getSolanaClient() as unknown as Record<string, unknown>
    // getBalance is a real Connection method; proxy must still produce a
    // function here (the lazy-call wrapper).
    expect(typeof client.getBalance).toBe('function')
    const sui = getSuiClient() as unknown as Record<string, unknown>
    expect(typeof sui.getBalance).toBe('function')
  })
})
