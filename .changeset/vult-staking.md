---
"@vultisig/core-mpc": minor
"@vultisig/sdk": patch
---

feat(keysign): VULT staking (sVULT) keysign builders + generic EVM contract-call routing

Adds `keysign/vultStaking/build` (depositFor with an optional VULT→sVULT approval
prepended, requestUnstake, claim, cancelUnstake) for native VULT staking on
Ethereum.

Stake reuses the swap-with-approval flow: the payload coin is the VULT token so
the EVM signing-input resolver can attach an `erc20ApprovePayload`, and the
`depositFor` calldata is emitted as a generic contract call. The routing
decision (token coin + zero `toAmount` + `0x` memo + no swap) is extracted into a
shared `getIsGenericContractCall` predicate now consumed by the signing-input,
fee-quote, and Blockaid simulation/validation resolvers so they all target the
same on-chain call (fixes gas being estimated against — and Blockaid scanning —
a synthetic ERC-20 transfer instead of the real `depositFor`). Patch-bumps
`@vultisig/sdk` to rebundle.
