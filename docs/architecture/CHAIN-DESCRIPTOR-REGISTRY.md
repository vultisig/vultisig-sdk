# Chain Descriptor Registry

## Decision

The SDK owns one exhaustive `chainRegistry`, keyed by the SDK's `Chain` union.
Consumers import that union and registry, derive projections with
`deriveFromChainRegistry`, and attach app-local fields with
`extendChainRegistry`. They do not redeclare a chain union or copy SDK-owned
metadata.

The first migrated descriptor slice is block-explorer metadata. The existing
`getBlockExplorerUrl` helper now derives address and transaction URLs from the
registry, so the prototype changes no existing URLs while establishing the
ownership and compile-safety boundary.

## Problem

The SDK's `Record<Chain, T>` tables already make a missing entry a compile
error inside this repository. Consumer applications lose that protection when
they redeclare a chain union, use `Record<string, T>`, or handle only selected
branches of a switch. Adding a chain can therefore compile in the SDK and be
silently absent elsewhere.

Issue [#1230](https://github.com/vultisig/vultisig-sdk/issues/1230) measured the
current blast radius and linked the consumer adoption work. This spike keeps
the migration incremental: it designs the complete boundary and proves it on
the explorer surface rather than moving every chain table at once.

## Public Contract

The support literal below is abbreviated pseudocode. Production code must
replace the omission comment with an entry for every `Chain` so the
`satisfies` check compiles.

```ts
import { Chain, chainRegistry, deriveFromChainRegistry, extendChainRegistry } from '@vultisig/sdk'

const explorerOrigins = deriveFromChainRegistry(descriptor => descriptor.explorer.baseUrl)

type AppSupport = { status: 'supported' } | { status: 'unsupported'; reason: string }

const support = {
  [Chain.Bitcoin]: { status: 'supported' },
  // every other Chain is required
  [Chain.QBTC]: { status: 'unsupported', reason: 'rollout pending' },
} satisfies Record<Chain, AppSupport>

const appChains = extendChainRegistry(support)
```

`chainRegistry` satisfies `Record<Chain, ChainDescriptor>` and explicitly
enumerates every chain. Adding a `Chain` member fails the SDK build until the
descriptor exists. A consumer extension that is written as a literal also has
to contain every `Chain`; a consumer can deliberately mark a new chain as
unsupported, but cannot omit it silently.

The derived form is preferred when the local value can be computed from SDK
facts. The extension form is for consumer-owned policy or presentation values
that genuinely differ by app.

## Target Descriptor

The target registry holds stable protocol and network facts:

```ts
type TargetChainDescriptor = {
  chain: Chain
  kind: ChainKind
  networkIds: {
    evmChainId?: number
    cosmosChainId?: string
    slip44?: number
  }
  nativeAsset: {
    ticker: string
    decimals: number
  }
  fee: {
    unit: string
    decimals: number
  }
  address: {
    family: AddressFamily
    accountPrefix?: string
    validatorPrefix?: string
  }
  explorer: {
    baseUrl: string
    paths: { address: string; tx: string }
  }
  capabilities: {
    memo: 'none' | 'optional' | 'required'
    tokens: boolean
    smartContracts: boolean
  }
}
```

Fields must be migrated from their existing authoritative table, then that
table becomes a projection of the registry. Copying a value into both places
would preserve the drift problem. The next likely slices are native asset and
fee metadata from `chainFeeCoin`, EVM and Cosmos network IDs from their current
chain-info modules, and address family/prefix facts from address validation.

Some imports currently run in the opposite direction—for example EVM chain
information reads native-asset metadata. Each slice must be moved with its
dependency edge, not assembled by introducing a cycle.

## Consumer Extensions

App-local fields stay outside the SDK descriptor and are joined exhaustively:

This example is also abbreviated pseudocode; every omitted `Chain` key is
required in a compiling consumer extension.

```ts
type AppSupport = { status: 'supported'; icon: string } | { status: 'unsupported'; reason: string }

const appSupport = {
  [Chain.Bitcoin]: { status: 'supported', icon: 'bitcoin' },
  // every other Chain is required
} satisfies Record<Chain, AppSupport>

const appRegistry = extendChainRegistry(appSupport)
```

The explicit unsupported state is important. It lets a consumer ship a staged
rollout without using `Partial`, a default branch, or a missing key as an
implicit support policy.

## Versioning And Rollout

- The package version is the compatibility boundary; the registry does not
  maintain a second independent chain-set version.
- The initial registry and helper exports are additive minor releases.
- Once consumers adopt the exhaustive contract, adding a `Chain` member is a
  major release: although the runtime entry is additive, it intentionally
  makes exhaustive consumer records fail to compile until support policy is
  explicit. Compatible minor ranges therefore cannot unexpectedly break CI.
- Consumers that cannot update immediately pin the previous SDK version. On
  update, they add either a supported or explicitly unsupported extension.
- Adding optional descriptor facts is additive and can ship in a minor
  release. Renaming/removing a field or changing its meaning requires a major
  release.
- Consumer CI typechecks against the SDK version it ships. There is no runtime
  fallback that invents metadata for an unknown chain.

This makes chain rollout order explicit: publish the SDK descriptor, update
consumer support policy under compiler pressure, and then enable the product
surface. A package update cannot silently broaden product support.

## Capability Ownership

The registry owns intrinsic facts: whether the protocol carries a memo, which
address family it uses, or whether the network supports tokens or smart
contracts. Consumers own policy: whether a feature is enabled, tested,
temporarily disabled, hidden, or available to a particular account or region.

When a proposed capability depends on provider availability, app UX, rollout
state, or operational confidence, it belongs in an exhaustive consumer
extension. When it describes the chain independent of any Vultisig product, it
belongs in the SDK registry.

## Migration Sequence

1. Explorer metadata and URL construction (this prototype).
2. Native asset decimals/ticker and fee units, with old exports becoming
   projections.
3. EVM/Cosmos network IDs, after removing dependency cycles.
4. Address family and protocol-level memo/token/contract capabilities.
5. Consumer adoption through the linked app and backend issues.

Each step keeps existing public helpers so consumers can migrate independently.
No step introduces `Partial<Record<Chain, ...>>` or a default fallback for
SDK-owned facts.
