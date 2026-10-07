---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
---

Blockaid-screen the SwapKit ERC-20 deposit recipient at quote time and on every co-signer, refusing only a confirmed Malicious verdict. New `screenSwapKitDepositRecipient` (`@vultisig/core-chain/swap/general/knownAggregatorRouters`) returns `benign`, `warning` (with features) or `notScanned` (unsupported chain, failed or rate-limited scan) so a review screen can show the advisory; pair it with `getKeysignSwapKitDepositRecipient`.
