---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Accept THORChain secured-asset `CHAIN-ASSET` notation in `parseThorSwapMemo`, so first-party consumers can parse swap memos that target secured assets like `ETH-USDC-0x…` and `XRP-XRP` without keeping drifted local parsers.
