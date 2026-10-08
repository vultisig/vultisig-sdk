---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Accept SwapKit ERC-20 deposit transfers (NEAR-Intents `simpleTransfer`) only when they are exactly `transfer(targetAddress, fromAmount)` on the sold token with no native value, at quote time and again on every co-signer. New `getKeysignSwapKitDepositRecipient` (`@vultisig/core-mpc/keysign/swap/getKeysignSwapKitDepositRecipient`) returns the recipient a payload signs so co-signers show the same address.
