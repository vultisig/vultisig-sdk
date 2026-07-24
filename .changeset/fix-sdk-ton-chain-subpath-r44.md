---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Publish `@vultisig/sdk/chains/ton` as a dedicated public subpath with its own JS and type bundles so TON helper imports resolve without falling back to the root SDK entry.
