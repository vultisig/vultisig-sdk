---
'@vultisig/sdk': patch
---

fix(sdk): defi follow-ups from merged-PR suggested changes

Three fixes across the DeFi calldata builders:

**sdk.defi.glif — BREAKING rename: `amount` -> `assetAmount` / `shareAmount`**
- `BuildGlifStakeParams.amount` -> `assetAmount` (ICNT asset units)
- `BuildGlifRedeemParams.amount` -> `shareAmount` (stICNT share units)
- Result fields `BuildGlifStakeResult.amount` -> `assetAmount`, `BuildGlifRedeemResult.amount` -> `shareAmount`
- Removes the ambiguity: stake inputs are ICNT (asset), redeem inputs are stICNT (shares)
- Tests updated to match

**sdk.defi.balancer — replace private-field reach-through with `ZERO_ADDRESS` sentinel**
- `buildBalancerV3SwapCalldata` previously reached into private SDK internals via
  `(swap as unknown as { swap: { to: ... } }).swap.to` (always returned `undefined`)
- Replaced with explicit `ZERO_ADDRESS` sentinel for the required-but-ignored
  `QueryOutputBase.to` field, matching the SDK's own documented intent
- Added post-`buildCall` assertion: throws if the returned router address is zero or
  invalid, so a future SDK breakage surfaces immediately rather than silently
  producing calldata targeting the zero address

**sdk.defi.arkis — re-throw transport errors from `resolvePoolKind`**
- The bare `catch {}` previously swallowed ALL errors (transport timeouts, rate-limit
  errors, network outages) and mis-classified every pool as an Agreement
- Now only swallows `ContractFunctionRevertedError` (the expected "no `asset()`"
  revert that signals a standard Agreement)
- Transport and RPC errors are re-thrown so callers can retry
