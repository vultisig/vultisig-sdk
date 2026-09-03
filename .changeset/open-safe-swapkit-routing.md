---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Open SwapKit routing for HyperEVM sources and destinations and Robinhood destinations, while keeping Robinhood source swaps disabled until Blockaid supports chain 4663. Future EVM corridors can now use an unambiguous live SwapKit catalog identity without another static eligibility-list change, and catalog failures remain isolated from other quote providers.
