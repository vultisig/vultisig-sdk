---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `resolveChainIdReference` from the root `@vultisig/sdk` surface so consumers can share the SDK's strict chain-ID-only resolver instead of duplicating it or over-accepting via `resolveChainReference`.
