---
'@vultisig/sdk': patch
---

Fix `supportedIbcDestinationsFrom()` returning a false-empty destination list for Vultisig canonical chain names. It filtered the route table with the raw `fromChain` string, so `"Osmosis"` returned `[]` while `"osmosis-1"` returned 12 destinations - even though `prepareIbcTransfer()` already normalises the same aliases and accepts them. It now normalises through `normaliseIbcChainId()` first, so both spellings agree.
