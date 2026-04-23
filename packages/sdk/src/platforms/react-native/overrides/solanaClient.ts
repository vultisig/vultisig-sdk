// RN override for `@vultisig/core-chain/chains/solana/client`.
//
// `@solana/web3.js` transitively imports `rpc-websockets`, which does
// `import WebSocketImpl from 'ws'` at module top-level. React Native's
// Hermes runtime has no `ws` module, so evaluating eagerly hangs
// `sdk.initialize()` before any Solana RPC is ever called.
//
// We expose `getSolanaClient` with the same sync signature as the core
// module (`() => Connection`) so callsites like
// `const client = getSolanaClient(); await client.getBalance(...)` work
// unchanged on both platforms. On RN we return a Proxy that lazy-imports
// `@solana/web3.js` only when a real method (e.g. `getBalance`,
// `sendRawTransaction`) is invoked. Every Connection method is already
// async, so the extra `await` for the deferred import flattens naturally.
import { rootApiUrl } from '@vultisig/core-config'
import { memoize } from '@vultisig/lib-utils/memoize'
import type { Connection } from '@solana/web3.js'

export const solanaRpcUrl = `${rootApiUrl}/solana/`

// Memoize the `new Connection(...)` construction so repeated method
// invocations reuse the same client instance. The first `.then(...)`
// chain caches; subsequent awaits resolve immediately from the cache.
let clientPromise: Promise<Connection> | undefined
const loadClient = (): Promise<Connection> => {
  if (!clientPromise) {
    clientPromise = import('@solana/web3.js').then(
      ({ Connection }) => new Connection(solanaRpcUrl)
    )
  }
  return clientPromise
}

const solanaClientProxy = new Proxy({} as Connection, {
  get(_target, prop) {
    // Every real Connection method is async; forward via lazy client load.
    return (...args: unknown[]) =>
      loadClient().then(client => {
        const fn = (client as unknown as Record<string | symbol, unknown>)[prop]
        if (typeof fn !== 'function') {
          throw new Error(
            `[solanaClient RN] property '${String(prop)}' is not a function on @solana/web3.js Connection`
          )
        }
        return (fn as (...a: unknown[]) => unknown).apply(client, args)
      })
  },
})

export const getSolanaClient = memoize((): Connection => solanaClientProxy)
