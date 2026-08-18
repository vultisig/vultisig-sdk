# Chain transaction ownership

Chain transaction code exists in several trees because the published packages
and the React Native bundle have different dependency constraints. The trees
are adapters, not independent specifications. Use the boundaries below when
adding a chain or changing transaction behavior.

| Concern | Authoritative tree | Adapter rule |
| --- | --- | --- |
| Keysign transaction construction | `packages/core/mpc/keysign/signingInputs/resolvers/<chain>` | SDK services should delegate to the core resolver. Standalone primitives in `packages/sdk/src/chains/<chain>` own only their explicitly documented raw/public API. |
| Shared chain RPC/config primitives | `packages/core/chain/chains/<chain>` | Reuse these outside React Native. Do not duplicate endpoint or chain rules in SDK services. |
| Broadcast outcome semantics | `packages/core/chain/tx/broadcast/resolvers/<chain>` | `RawBroadcastService` and `packages/sdk/src/platforms/react-native/chains/<chain>` must preserve the same idempotency and ambiguous-error verification guarantees. Platform adapters may change transport, not the success contract. |
| Confirmation and execution status | `packages/core/chain/tx/status/resolvers/<chain>` | This is the authority for pending/success/error interpretation. A broadcast result means the payload was accepted; callers still poll status to a terminal result. |
| React Native transport or wire encoding | `packages/sdk/src/platforms/react-native/chains/<chain>` | Keep only code required to avoid Node-only dependency graphs. Share pure parsers/building blocks from `packages/sdk/src/chains/<chain>` and add parity tests against the core contract. |

## Change checklist

When broadcast or confirmation behavior changes for a chain:

1. Change the authoritative core resolver or status resolver first.
2. Inspect `RawBroadcastService` and the React Native chain adapter for the
   same chain; update them when the public raw/RN surfaces are affected.
3. Test duplicate submission, an ambiguous transport failure whose hash is
   found, an unknown hash, and an explicit on-chain failure.
4. Keep final confirmation separate from broadcast acceptance. Never turn an
   unverified transport error into success.

Solana's core and React Native broadcast surfaces are the reference example:
both derive the primary signature from the signed payload;
`AlreadyProcessed` is idempotent broadcast acceptance; other ambiguous errors
are resolved by a bounded, retrying signature lookup; and the status resolver
remains authoritative for the eventual execution result.
