---
'@vultisig/sdk': patch
---

Publish `@vultisig/sdk/tools/policy` as a real package subpath with dedicated runtime and type bundles. The pure intent↔envelope policy diff layer (`policy.evaluate`, `policy.checkInvariants`, plus the underlying amount/chain-matching helpers) already existed and was re-exported from the root barrel, but consumers had no stable narrow surface to depend on and were pushed toward root-only imports or local wrappers.
