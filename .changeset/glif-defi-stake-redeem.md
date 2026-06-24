---
'@vultisig/sdk': minor
---

feat(sdk): add `sdk.defi.glif` — GLIF x ICN liquid-staking calldata builders

Adds the first protocol under the new `sdk.defi.*` namespace:

- `buildGlifStakeIcnt(...)` — unsigned `[approve?, deposit]` to stake ICNT and mint
  stICNT on Base (ERC-4626 `deposit(assets, receiver)`). The approve step is dropped
  when `currentAllowance >= amount`; the approve spender is pinned to the pool and the
  approved amount is bounded to the exact stake amount (never unlimited).
- `buildGlifRedeemSticnt(...)` — unsigned `[redeem]` to redeem stICNT back to ICNT
  (`redeem(shares, receiver, owner)`, with `owner` always pinned to `from`).

Both builders are pure / offline (no RPC), produce UNSIGNED calldata only, and are
exported from the generic and React Native entry points. Pinned Base addresses are
verified on-chain (`pool.asset() == ICNT`, `pool.symbol() == stICNT`).
