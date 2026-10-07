---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
---

Signing inputs and fee amounts on every chain refuse an aggregator swap whose sold coin is missing or is not the keysign coin (chain, native flag and contract; contracts compare case-insensitively on EVM only), as iOS and Android do. New `assertKeysignSwapSellsSigningCoin` (`@vultisig/core-mpc/keysign/swap/assertKeysignSwapSellsSigningCoin`) lets co-signer screens refuse the same payloads before approval.
