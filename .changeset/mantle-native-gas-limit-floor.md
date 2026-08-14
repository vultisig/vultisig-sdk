---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fix Mantle native-send gas limit floor: was hardcoded to 90,000,000 (~4300x what a real transfer uses), now 400,000 (matches real mainnet sender behavior). The old floor stranded ~6.75 MNT on every "max send" and could block a send outright on a wallet holding less than that. capGasLimit still prefers a higher live eth_estimateGas answer when one is available — this is only the safety-net minimum.
