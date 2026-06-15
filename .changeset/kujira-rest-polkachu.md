---
'@vultisig/core-chain': patch
---

fix(cosmos): point Kujira LCD/REST at polkachu

`kujira-rest.publicnode.com` started platform-gating and now returns HTTP 403, breaking Kujira native balance reads. Switch the Kujira LCD/REST endpoint to `https://kujira-api.polkachu.com` (same `/cosmos/bank/v1beta1/balances/{address}` path), matching the host `getCosmosAccountInfo` already uses for Kujira.
