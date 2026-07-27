// RN override for `@vultisig/core-chain/chains/sui/client`.
//
// Two RN-specific problems, one proxy:
//
// 1. `@mysten/sui` evaluates `new Intl.PluralRules(...)` at module top-level
//    (see `@mysten/sui/dist/client/utils.mjs`). Hermes ships without
//    `Intl.PluralRules`, so importing eagerly crashes `sdk.initialize()`.
//    The Proxy below lazy-imports the client only when a method is invoked.
//
// 2. Core now talks gRPC (Sui is retiring JSON-RPC), but `SuiGrpcClient` speaks
//    grpc-web through `GrpcWebFetchTransport`, which reads `Response.body` as
//    a `ReadableStream`. Hermes' XHR-backed `fetch` exposes no `Response.body`,
//    so every grpc-web call would throw "missing response body". Sui's other
//    supported replacement, GraphQL RPC, is a plain JSON POST — and
//    `SuiGraphQLClient` implements the SAME unified surface
//    (`SuiClientTypes.TransportMethods`) as `SuiGrpcClient`, so RN swaps the
//    transport without changing a single callsite.
//
// `getSuiClient` therefore keeps the core module's sync signature
// (`() => SuiClient`) so callsites that do
// `const client = getSuiClient(); await client.getBalance(...)` work unchanged
// on both platforms. Every method on the unified client is async, so the extra
// `await` for the deferred import flattens naturally.
import type { SuiGraphQLClient } from '@mysten/sui/graphql'
import type { SuiClient } from '@vultisig/core-chain/chains/sui/client'
import { suiGraphqlUrl, suiNetwork } from '@vultisig/core-chain/chains/sui/config'
import { memoize } from '@vultisig/lib-utils/memoize'

let clientPromise: Promise<SuiGraphQLClient> | undefined
const loadClient = (): Promise<SuiGraphQLClient> => {
  if (!clientPromise) {
    clientPromise = import('@mysten/sui/graphql').then(
      ({ SuiGraphQLClient }) =>
        new SuiGraphQLClient({
          url: suiGraphqlUrl,
          network: suiNetwork,
        })
    )
  }
  return clientPromise
}

// Same rationale as solanaClient: returning a function for `then` would make
// the proxy thenable and cause `await proxy` to hang / recurse. Symbol probes
// (Symbol.toPrimitive, Symbol.iterator, etc) similarly must return undefined.
const NON_METHOD_PROPS = new Set<string | symbol>([
  'then',
  'catch',
  'finally',
  'toJSON',
  'toString',
  'valueOf',
  Symbol.toPrimitive,
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
])

const suiClientProxy = new Proxy({} as SuiGraphQLClient, {
  get(_target, prop) {
    if (typeof prop === 'symbol' || NON_METHOD_PROPS.has(prop)) {
      return undefined
    }
    return (...args: unknown[]) =>
      loadClient().then(client => {
        const fn = (client as unknown as Record<string | symbol, unknown>)[prop]
        if (typeof fn !== 'function') {
          throw new Error(
            `[suiClient RN] property '${String(prop)}' is not a function on @mysten/sui/graphql SuiGraphQLClient`
          )
        }
        return (fn as (...a: unknown[]) => unknown).apply(client, args)
      })
  },
})

export type { SuiClient }

export const getSuiClient = memoize((): SuiClient => suiClientProxy as unknown as SuiClient)
