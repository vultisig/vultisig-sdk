---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

An EVM aggregator swap that cannot be simulated is now signed with 1.5× the route's own gas figure instead of the generic 900,000 fallback. Swaps from an ERC-20 always take this path, because their allowance does not exist yet when the fee is quoted. A 1 USDC → USDT route that used 175,783 gas used to quote 900,000; it now quotes about 1.5× the aggregator's figure. An unsimulated route whose figure exceeded 900,000 used to be signed at that figure with no headroom, though aggregators can come in below the real cost. It now gets the same 1.5× headroom. Arbitrum, Robinhood, Mantle and zkSync keep the old fallback, since their gas also pays for posting data and an off-chain figure leaves that out. New export: `getEvmGasIncludesDataCost` from `tx/fee/evm/evmGasLimit`.
