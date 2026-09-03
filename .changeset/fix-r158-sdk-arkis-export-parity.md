---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Expose the Arkis helper family as named public exports from `@vultisig/sdk/tools/defi` and the root `@vultisig/sdk` surface so consumers no longer need deep imports or namespace-only access through `sdk.defi.arkis`.
