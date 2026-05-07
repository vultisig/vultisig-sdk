---
'@vultisig/core-chain': minor
---

Add a static lookup table of common EVM function selectors (`chains/evm/contract/commonSelectors.ts`) with human-readable action labels, and consult it as an offline fast-path in `getEvmContractCallInfo` before falling back to the 4byte API. Covers ERC-20 approvals/transfers/permit, Uniswap V2 / V3 / Universal Router swaps, ERC-721/1155 approvals and transfers, WETH wrap/unwrap, Synthetix-style staking, multicall, THORChain Router cross-chain swaps, and Aave V3 supply/withdraw. Resolved entries expose an optional `actionLabel` (e.g. "Token Approval", "Token Swap", "Cross-Chain Swap", "Lending Supply", "NFT Transfer") on the returned info.
