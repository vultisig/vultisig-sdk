---
'@vultisig/sdk': patch
---

The Uniswap V3 tool tables now include Robinhood (4663) with the factory Uniswap publishes for the chain and its WETH9, which matches the WETH entry in the Robinhood token catalog. `supportedUniV3Chains()` lists Robinhood, `resolveNativeToken('native', 'Robinhood')` returns WETH9, and `uniswapV3PoolInfo` no longer reports Uniswap as undeployed there.
