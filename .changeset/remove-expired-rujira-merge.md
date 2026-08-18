---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Make the expired, zero-caller Rujira merge-balance service inert. The KUJI-to-RUJI merge window closed on 2026-04-05, so the compatibility shim now returns an empty result without querying GraphQL.
