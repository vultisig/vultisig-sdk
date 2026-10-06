---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Accept SwapKit ERC-20 deposit transfers (NEAR-Intents `simpleTransfer`) only when they are exactly `transfer(targetAddress, fromAmount)` on the sold token with no native value, Blockaid-screen the recipient, and size their gas from the transfer's own simulation. New `getKeysignSwapKitDepositRecipient` (`@vultisig/core-mpc/keysign/swap/getKeysignSwapKitDepositRecipient`) returns the recipient a payload signs so co-signers show and screen the same address; it refuses a `tx.value` or `fromAmount` that is not a plain decimal within uint256. The EVM signer refuses any aggregator swap whose sold coin is not the keysign coin (chain, native flag and contract), as iOS and Android do.
