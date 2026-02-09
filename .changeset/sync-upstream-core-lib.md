---
"@vultisig/sdk": patch
---

Sync upstream core and lib from vultisig-windows

- Solana: support multiple raw transactions in signing inputs
- EVM: fetch token logos from 1Inch API in metadata resolver
- Cosmos: normalize fee denominations with toChainFeeDenom helper
- Cosmos: filter out TCY autocompounder share denom from coin discovery
- Cosmos: add AZTEC token to Thorchain known tokens
- Swap: add getSwapTrackingUrl utility for block explorer URLs
- Remove unused getRecordSize utility
