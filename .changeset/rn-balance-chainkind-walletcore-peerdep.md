---
'@vultisig/sdk': patch
---

fix(rn): key the React Native `getCoinBalance` resolver dispatch by `ChainKind`
instead of `string`, so a new chain kind added to core now breaks the RN build at
compile time instead of silently throwing at runtime. Also declare
`@vultisig/walletcore-native` as an optional `workspace:*` peer dependency (matching
the existing `@vultisig/mpc-native` sibling) — the RN entrypoint value-imports it and
marks it external in the RN bundle, so it must be declared for RN consumers.
