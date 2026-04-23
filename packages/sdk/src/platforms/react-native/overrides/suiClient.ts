// RN override for `@vultisig/core-chain/chains/sui/client`.
//
// `@mysten/sui` evaluates `new Intl.PluralRules(...)` at module top-level
// (see `@mysten/sui/dist/client/utils.mjs`). Hermes ships without
// `Intl.PluralRules`, so importing eagerly crashes `sdk.initialize()`.
//
// We expose `getSuiClient` with the same sync signature as the core
// module (`() => SuiJsonRpcClient`) so callsites that do
// `const client = getSuiClient(); await client.getBalance(...)` work
// unchanged on both platforms. On RN we return a Proxy that lazy-imports
// `@mysten/sui/jsonRpc` only when a real method is invoked. Every
// SuiJsonRpcClient method is async, so the extra `await` for the
// deferred import flattens naturally.
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { memoize } from '@vultisig/lib-utils/memoize'

let clientPromise: Promise<SuiJsonRpcClient> | undefined
const loadClient = (): Promise<SuiJsonRpcClient> => {
  if (!clientPromise) {
    clientPromise = import('@mysten/sui/jsonRpc').then(
      ({ SuiJsonRpcClient }) =>
        new SuiJsonRpcClient({
          url: 'https://sui-rpc.publicnode.com',
          network: 'mainnet',
        })
    )
  }
  return clientPromise
}

const suiClientProxy = new Proxy({} as SuiJsonRpcClient, {
  get(_target, prop) {
    return (...args: unknown[]) =>
      loadClient().then(client => {
        const fn = (client as unknown as Record<string | symbol, unknown>)[prop]
        if (typeof fn !== 'function') {
          throw new Error(
            `[suiClient RN] property '${String(prop)}' is not a function on @mysten/sui/jsonRpc SuiJsonRpcClient`
          )
        }
        return (fn as (...a: unknown[]) => unknown).apply(client, args)
      })
  },
})

export const getSuiClient = memoize((): SuiJsonRpcClient => suiClientProxy)
