---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

An explicit "empty the account" send can now be initiated: `prepareSendTx`, `prepareSendTxFromKeys`, `send` and `getMaxSendAmount` accept `allowDeath`, both chain-specific resolvers record it in `PolkadotSpecific.allowDeath` and price that call, and the MAX/refinement keep nothing back for the existential deposit. The CLI gains `send <Polkadot|Bittensor> <to> --max --allow-death`, which discloses the reap before confirmation. Only set it for an explicit user choice; every co-signer must read the field.
