---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Sign Sei as EIP-1559 (enveloped) instead of legacy, matching iOS
(`EVMHelper.setGasParameters`) and Android (`EthereumGasHelper.setGasParameters`),
which sign every EVM chain except BSC as EIP-1559. Sei was the only
enveloped-capable EVM chain still mapped to `'legacy'` in
`evmChainTxFeeFormat`, so the pre-signing hash (and therefore the relay
`message_id`) diverged between mobile and extension/desktop, deadlocking
Sei co-signing between them (vultisig-windows#4369).
