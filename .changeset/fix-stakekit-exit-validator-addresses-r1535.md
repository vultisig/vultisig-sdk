---
'@vultisig/sdk': patch
---

Nest `validatorAddresses` inside `args` on the StakeKit `exit` REST fallback body, matching the `enter` path and the declared `{ integrationId, addresses, args }` wire shape. It was previously sent as a top-level sibling, outside the field the API contract declares — a validator-targeted unstake/withdraw over the REST fallback could silently lose its validator selection.
