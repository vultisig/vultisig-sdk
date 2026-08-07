---
'@vultisig/cli': patch
---

fix(cli): `tokens --add` stores the bare contract address as the id, matching `discoverTokens`, instead of a `${chain}-${contractAddress}` prefix that rendered as a double-prefix key (`Ethereum:Ethereum-0x...`) in the balances map
