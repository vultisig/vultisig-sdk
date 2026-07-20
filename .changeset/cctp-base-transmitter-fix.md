---
"@vultisig/sdk": patch
---

Fix the CCTP Base MessageTransmitter address to Circle's published contract (0xAD09780d193884d503182aD4588450C416D6F9D4). The previous value was a codeless EOA lookalike, so a Base claim's receiveMessage succeeded without minting (burn-without-mint fund loss). Registry is now pinned to Circle's published V1 addresses by test.
