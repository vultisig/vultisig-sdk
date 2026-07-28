import type { SuiClientTypes } from '@mysten/sui/client'

export const suiGasBudget = 3000_000n
export const suiMinGasBudget = 2000n

export const suiNetwork: SuiClientTypes.Network = 'mainnet'

/**
 * Sui full node gRPC endpoint (grpc-web over HTTPS).
 *
 * Sui is retiring JSON-RPC: shutdown on Foundation mainnet full nodes began the
 * week of 2026-07-27 and full decommission (code removal) lands mid-October
 * 2026, after which no provider can serve it. gRPC and GraphQL RPC are the
 * supported replacements, so every Sui read/simulate/execute in this repo goes
 * through one of them. (JSON-RPC still answered on 2026-07-27 — this is a
 * migration ahead of the deadline, not a response to a live outage.)
 *
 * The previously-used `sui-rpc.publicnode.com` is JSON-RPC only — it answers
 * nothing over gRPC — so the endpoint moves to the Foundation full node.
 */
export const suiGrpcUrl = 'https://fullnode.mainnet.sui.io:443'

/**
 * Sui GraphQL RPC endpoint.
 *
 * Used on React Native: `@mysten/sui`'s gRPC client speaks grpc-web through
 * `GrpcWebFetchTransport`, which reads `Response.body` as a `ReadableStream`.
 * Hermes' XHR-backed `fetch` exposes no `Response.body`, so grpc-web throws
 * "missing response body" there. GraphQL RPC is a plain JSON POST and exposes
 * the exact same unified client surface (`SuiClientTypes.TransportMethods`),
 * so RN keeps identical call sites. See
 * `packages/sdk/src/platforms/react-native/overrides/suiClient.ts`.
 */
export const suiGraphqlUrl = 'https://graphql.mainnet.sui.io/graphql'
