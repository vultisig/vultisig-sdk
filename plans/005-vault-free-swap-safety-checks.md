# Plan 005: Add amount↔quote consistency + expiry checks to the agent-reachable vault-free swap helper

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result. If anything in "STOP conditions" occurs, stop and report — do not
> improvise. When done, update the status row for plan 005 in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a26df8fd..HEAD -- packages/sdk/src/tools/prep/swap.ts packages/sdk/src/vault/services/SwapService.ts packages/core/mpc/keysign/swap/build.ts`
> Compare the "Current state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition. Also confirm the audit-time merge conflict in
> `findSwapQuote.selection.test.ts` is resolved.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (fund-safety, agent-reachable)
- **Planned at**: commit `a26df8fd`, 2026-07-08

## Why this matters

`prepareSwapTxFromKeys` (`packages/sdk/src/tools/prep/swap.ts`) is the **vault-free** swap payload
builder — its own docstring says it's "intended for MCP servers and other contexts where only the
public identity is available." That means it's the **agent-reachable** path. It takes `amount` and
`swapQuote` as *independent* parameters and does two unsafe things the vault wrapper does not:

1. **No amount↔quote cross-check.** For a native swap, the signed input amount is taken from the
   caller's `amount` (`build.ts:129`), while the slippage/min-out limit comes from the quote's own
   sizing. If a caller passes an `amount` inconsistent with the size the quote was calculated for,
   the payload gets a mis-calibrated on-chain min-out limit.
2. **No quote-expiry enforcement.** The docstring explicitly punts: *"Quote expiry validation is also
   a consumer concern."* The vault wrapper `SwapService.prepareSwapTx` checks
   `Date.now() > params.swapQuote.expiresAt` (`SwapService.ts:131`) before delegating — the vault-free
   helper bypasses it, so an agent can sign a stale quote.

Impact is bounded (the aggregator's on-chain min-return caps the worst case to a revert or bounded-worse
fill), which is why this is MEDIUM not HIGH — but it's the exact enforced-in-vault / skipped-in-agent-path
asymmetry worth closing. The fix moves both checks *into* the vault-free helper so every caller (vault
and agent) gets them.

## Current state

- `packages/sdk/src/tools/prep/swap.ts` — `prepareSwapTxFromKeys(identity, params, walletCoreOverride?)`.
  `params` is `{ fromCoin, toCoin, amount: string | number, swapQuote: SwapQuote }`. It builds
  `fromPublicKey`/`toPublicKey` then calls `buildSwapKeysignPayload({...})`. No validation. Docstring:
  ```
  * Coin-input resolution must be performed by the caller ... Quote expiry validation is also a
  * consumer concern.
  ```
- `packages/sdk/src/vault/services/SwapService.ts:128-133` — the vault path's expiry check that the
  vault-free helper skips:
  ```ts
  async prepareSwapTx(params: SwapTxParams): Promise<SwapPrepareResult> {
    try {
      // Validate quote hasn't expired
      if (Date.now() > params.swapQuote.expiresAt) {
        throw new VaultError(VaultErrorCode.InvalidConfig, 'Swap quote has expired. Please refresh the quote.')
      }
  ```
- `packages/core/mpc/keysign/swap/build.ts:129` — the native-swap amount derivation:
  ```ts
  const chainAmount = transferTx?.amount ?? toChainAmount(amount, fromCoin.decimals)
  ```
  For native swaps `transferTx` is undefined, so `chainAmount` comes from the caller's `amount`.
- `packages/core/chain/amount/toChainAmount.ts` — the hardened human→base-unit converter to reuse.
- The native quote's committed sell amount / expiry live on the quote object. Inspect `SwapQuote`
  (`packages/core/chain/swap/quote/SwapQuote.ts`) and the native quote shape to find (a) the sell
  amount the quote was computed for and (b) the expiry field. The native path already has
  `assertQuoteNotExpired(expirySeconds)` in
  `packages/core/mpc/swap/native/utils/nativeSwapQuoteToSwapPayload.ts` — reuse/mirror it.

Conventions: the prep tools throw typed errors and follow the inline-invariant discipline of the
trc20/spl builders (assert, then build). Match that. Vault-layer callers throw `VaultError`; the
vault-free helper should throw a plain coded `Error` (it must not depend on the vault layer) — the
vault wrapper can keep its own `VaultError` check or defer to the helper's (see Step 3).

## Commands you will need

| Purpose   | Command                                             | Expected on success |
|-----------|-----------------------------------------------------|---------------------|
| Typecheck | `yarn typecheck`                                     | exit 0              |
| SDK tests | `yarn workspace @vultisig/sdk test`                  | all pass            |
| New test  | `yarn workspace @vultisig/sdk test -- prepareSwap`   | new tests pass      |

## Scope

**In scope**:
- `packages/sdk/src/tools/prep/swap.ts` — add expiry + amount↔quote checks; update the docstring.
- The nearest existing prep test file (create `packages/sdk/tests/unit/tools/prep/swap.test.ts` if
  none exists; locate via `grep -rln "prepareSwapTxFromKeys\|prepareSendTxFromKeys" packages/sdk/tests`).

**Out of scope** (do NOT touch):
- `packages/core/mpc/keysign/swap/build.ts` — the core builder is fine; validation belongs at the
  vault-free boundary.
- `SwapService.ts` — if you leave its own `expiresAt` check in place it's a harmless double-check;
  do NOT remove it in this plan (removing it is an optional cleanup, not worth the blast radius here).
- Any other prep tool.

## Git workflow

- Branch: `advisor/005-vault-free-swap-safety-checks`
- Conventional commits (e.g. `fix(prep): enforce quote expiry + amount consistency in vault-free swap builder`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Enforce quote expiry inside the helper

At the top of `prepareSwapTxFromKeys`, before building public keys, assert the quote hasn't expired.
Read the expiry off `params.swapQuote` the same way `SwapService.ts:131` and the native
`assertQuoteNotExpired` do (native uses `expiry` seconds; general uses `expiresAt` ms — handle both
quote shapes via the `SwapQuote` union, matching how `SwapService` computes `expiresIn` around
`SwapService.ts:359-360`). Throw a coded error on expiry.

**Verify**: `yarn typecheck` → exit 0.

### Step 2: Cross-check the caller's amount against the quote's committed sell amount

Derive `toChainAmount(params.amount, params.fromCoin.decimals)` and assert it equals the sell amount
the quote was computed for (the field on the native quote; for general/aggregator quotes the sell
amount is encoded in `tx.data`, so a strict equality may not be available — in that case bind only
what's confidently comparable and defer otherwise, mirroring the fail-open discipline: do NOT throw on
a general quote you can't compare). Throw a coded error only on a *confident* mismatch.

**Escape hatch**: if the `SwapQuote` type does not expose the quote's committed sell amount in a form
you can compare for native swaps, STOP and report — do not invent a comparison that could false-reject
legit callers. The expiry check (Step 1) is the higher-value half and can land alone.

**Verify**: `yarn typecheck` → exit 0.

### Step 3: Update the docstring

Remove the "Quote expiry validation is also a consumer concern" sentence; state that the helper now
enforces expiry and amount↔quote consistency itself, so all callers (vault + agent) are covered.

### Step 4: Tests

Add tests: expired quote → throws; fresh quote + consistent amount → builds a payload; (if Step 2
landed) inconsistent native amount → throws; general/aggregator quote that can't be strictly
compared → still builds (no false reject).

**Verify**: `yarn workspace @vultisig/sdk test -- prepareSwap` → all pass. `yarn workspace @vultisig/sdk test` → all pass.

## Test plan

- New tests in `packages/sdk/tests/unit/tools/prep/swap.test.ts` (or the located prep test file).
- Cases: expired-quote throws; fresh+consistent builds; inconsistent-native-amount throws (if Step 2
  landed); un-comparable general quote does not false-reject.
- Model after the existing prep-tool tests (send/trc20) for identity/fixture setup.
- Verification: `yarn workspace @vultisig/sdk test -- prepareSwap` → all pass.

## Done criteria

- [ ] `yarn typecheck` exits 0
- [ ] `yarn workspace @vultisig/sdk test` passes; new expiry + (if landed) amount-consistency tests exist
- [ ] `grep -n "consumer concern" packages/sdk/src/tools/prep/swap.ts` returns nothing (docstring updated)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row for 005 updated (BLOCKED-with-note if Step 2's escape hatch fired
      and only expiry landed)

## STOP conditions

Stop and report if:
- The `SwapQuote` type doesn't expose a comparable committed sell amount for native swaps (Step 2
  escape hatch) — land expiry alone, report the amount-check as needing a quote-shape change.
- Adding the expiry check breaks an existing test that deliberately signs an "expired" fixture (some
  test vectors use past timestamps) — adjust the fixture's timestamp, don't weaken the check.
- The live `prepareSwapTxFromKeys` doesn't match the "Current state" excerpt (drift).
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Once the helper self-enforces expiry, `SwapService.ts:131`'s check becomes a redundant double-guard
  — safe to leave; a future cleanup could remove it, but only with the helper's check proven in place.
- Any NEW vault-free prep helper that takes a quote (e.g. a future bridge builder) should follow the
  same "validate at the vault-free boundary" rule — the whole point is that the agent-reachable entry
  point is where fund-safety checks must live, not only the vault wrapper.
- Related report items to fold in when touching this path: `fromChainAmount` float division feeding
  the swap confirm display (SDK-CORRECTNESS-01) — a bigint `formatBaseUnits` fix.
