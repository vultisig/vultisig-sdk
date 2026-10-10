---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Signing inputs and fee amounts on every chain refuse a swap (every provider, THORChain and Maya included) whose sold coin is missing or is not the keysign coin (chain, native flag, contract, ticker and decimals; contracts compare case-insensitively on EVM only), as iOS and Android do. A THORChain secured-asset withdrawal (`isSecuredAssetWithdrawal`, e.g. `@vultisig/rujira` withdraw) is exempt, since its deposit is built from the L1 asset its payload names. New `assertKeysignSwapSellsSigningCoin` (`@vultisig/core-mpc/keysign/swap/assertKeysignSwapSellsSigningCoin`) lets co-signer screens refuse the same payloads before approval.
