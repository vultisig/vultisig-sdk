---
"@vultisig/core-chain": minor
"@vultisig/sdk": minor
---

Add QBTC governance support under `chains/cosmos/qbtc/governance/`: REST clients for the Cosmos `x/gov v1` proposals, tally, votes and params endpoints, plus the domain types and wire parsers. Mirrors the existing `qbtc/claim` split and is consumed by the wallet's QBTC governance UI.
