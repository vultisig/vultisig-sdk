---
'@vultisig/rujira': patch
---

Thread the signer's configured THORChain chain ID into the withdrawal keysign payload instead of hardcoding `thorchain-1`. `VultisigRujiraProvider` already supports a non-default `chainId` (constructor param, used elsewhere for sign-doc validation), but the withdrawal path ignored it and always signed against mainnet — a stagenet/testnet-configured provider could not withdraw against its own configured chain.
