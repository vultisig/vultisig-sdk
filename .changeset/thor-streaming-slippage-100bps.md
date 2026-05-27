---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

## Changed

- Lower THORChain streaming-quote trigger threshold from 300 bps (3%) to 100 bps (1%) - more mid-size cross-chain trades now compare a streaming quote against the rapid quote and pick the better expected_amount_out. (#470)
