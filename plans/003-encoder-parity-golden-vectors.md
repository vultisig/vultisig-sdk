# Plan 003: Golden-vector-bind the two tx-encoder families (RN pure-JS vs WalletCore)

> **Executor instructions**: Follow this plan step by step. This plan ADDS TESTS ONLY — it does
> not change any encoder. If the new parity test fails, that is a real finding to REPORT, not a
> signal to "fix the test" by loosening it. Run every verification command and confirm the
> expected result. If anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for plan 003 in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a26df8fd..HEAD -- packages/core/mpc/tx/compile packages/sdk/src/platforms/react-native/chains`
> Also confirm the working tree is clean of the audit-time merge conflict in
> `packages/core/chain/swap/quote/findSwapQuote.selection.test.ts` before starting.

## Status

- **Priority**: P1
- **Effort**: M (test harness only)
- **Risk**: LOW (no production code changes)
- **Depends on**: none
- **Category**: tests (fund-safety net for cross-device signing)
- **Planned at**: commit `a26df8fd`, 2026-07-08

## Why this matters

The SDK ships **two independent transaction-encoder families** that produce pre-signing hashes for
the same funds:

1. **Canonical WalletCore-WASM path** — `packages/core/mpc/tx/compile/compileTx.ts` +
   `getPreSigningHashes`. This is what the iOS/Android native co-signers use.
2. **Parallel pure-JS family** — `packages/sdk/src/platforms/react-native/chains/{evm,cosmos,solana,sui,ripple}/tx.ts`.
   Its EVM module's docstring literally reads *"Vendored from vultiagent-app/src/services/evmTx.ts"*,
   rebuilt on viem so it runs on Hermes/RN where WASM can't load.

In a 2-of-2 MPC keysign between an RN device (pure-JS path) and an iOS/Android device (WalletCore
path), **both sides must hash byte-identical pre-signing bytes**. Any divergence (gas-field ordering,
EIP-1559-vs-legacy selection, cosmos varint/fee-denom, memo handling) → mismatched hashes → a failed
signing, or worse, a signature over a payload the user never saw. This is the same class as the
already-shipped terra-classic cross-device gas-limit bug.

Today nothing binds the two families. The RN golden test
(`packages/sdk/tests/unit/platforms/react-native/tx-builder-golden-vectors.test.ts`) asserts the RN
output against **viem's `serializeTransaction`** and **`@solana/web3.js`** — the very libraries the RN
encoder is built on, so it's near-tautological and cannot catch RN-vs-WalletCore divergence. This plan
adds the missing net: one `KeysignPayload` per chain fed into BOTH families, asserting byte-identical
pre-signing hashes.

## Current state

- `packages/core/mpc/tx/compile/compileTx.ts` — WASM compile path. There is already a strong golden
  suite next to it: `packages/core/mpc/tx/compile/compileTx.golden.test.ts` (compares MPC
  `compileWithSignatures` to WalletCore `AnySigner` from the same key; EVM also vs viem). It covers
  EVM, Solana, Cosmos, Cardano, Bittensor, QBTC. **Read it first — it is the structural pattern to
  reuse.**
- `packages/sdk/src/platforms/react-native/chains/evm/tx.ts` — `buildEvmSendTx`, `buildErc20TransferTx`;
  each returns a built tx exposing `signingHashHex` (the RN golden test asserts
  `tx.signingHashHex === keccak256(viemUnsigned)`).
- `packages/sdk/src/platforms/react-native/chains/solana/tx.ts` — `buildSolanaSendTx`.
- The RN golden test (excerpt of what it asserts today):
  ```ts
  import { buildEvmSendTx } from '../../../../src/platforms/react-native/chains/evm/tx'
  // ...
  expect(tx.signingHashHex).toBe(keccak256(viemUnsigned)) // vs viem — the lib it's built on
  ```
- The WASM path's pre-signing hash entry point is `getPreSigningHashes` (grep for it:
  `grep -rn "getPreSigningHashes" packages/core/mpc`). Confirm its exact signature and how
  `compileTx.golden.test.ts` obtains the WalletCore hash for a chain — reuse that exact mechanism.

Conventions: SDK tests are vitest. Core tests run via `yarn test:core` (config
`.config/vitest.core.config.ts`); SDK-package tests via `yarn workspace @vultisig/sdk test`. The
golden-vector style is fixed test vectors as top-level `const`s (see the RN test's `SOLANA_*`/`EVM_*`
constants). Match it.

## Commands you will need

| Purpose   | Command                                            | Expected on success |
|-----------|----------------------------------------------------|---------------------|
| Typecheck | `yarn typecheck`                                    | exit 0              |
| Core tests | `yarn test:core`                                   | all pass            |
| SDK tests | `yarn workspace @vultisig/sdk test`                 | all pass            |
| New test (SDK) | `yarn workspace @vultisig/sdk test -- <newfile>` | new parity tests pass OR fail with a real divergence (report) |

## Scope

**In scope**:
- A new test file: `packages/sdk/tests/unit/platforms/react-native/encoder-parity.test.ts` (or the
  location that can import BOTH the RN builders and the WASM `getPreSigningHashes`/`compileTx` —
  determine which package can see both; if core can't import the RN platform build, put the parity
  test in the SDK package where both are reachable).

**Out of scope** (do NOT modify — this plan only observes):
- Any encoder in `packages/core/mpc/tx/compile/` or `packages/sdk/src/platforms/react-native/chains/`.
- If the parity test reveals a divergence, DO NOT fix the encoder in this plan — record the exact
  input, both hashes, and which family diverged, and report. The fix is a separate, risk-assessed plan.
- `findSwapQuote.ts` and the merge-conflicted test (unrelated).

## Git workflow

- Branch: `advisor/003-encoder-parity-golden-vectors`
- Conventional commits (e.g. `test(parity): assert RN and WalletCore encoders agree on pre-signing hashes`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Learn both entry points

Read `compileTx.golden.test.ts` end-to-end and identify exactly how it derives the WalletCore
pre-signing hash for EVM and Solana. Read the RN `evm/tx.ts` and `solana/tx.ts` to see how their
`signingHashHex` is produced. Confirm you can call both from one test file with one shared input.

**Verify**: you can, in a scratch test, obtain (a) the RN `signingHashHex` and (b) the WalletCore
pre-signing hash for a single fixed EVM send, without modifying either module.

### Step 2: EVM parity vector

Write the first parity case: a fixed EVM native send (reuse the RN test's `EVM_*` constants as the
input so the vectors are shared). Assert `rnHash === walletCoreHash`. Then an ERC-20 transfer case
(reuse `ERC20_TRANSFER_*`).

**Verify**: `yarn workspace @vultisig/sdk test -- encoder-parity` → passes, OR fails with a concrete
hash mismatch. If it fails, capture both hashes + the input and go to STOP conditions (report — do
not adjust the encoder).

### Step 3: Solana parity vector

Add a Solana send case (reuse `SOLANA_*` constants). Assert the RN message/hash equals the WalletCore
message/hash for the same payload.

**Verify**: same as Step 2.

### Step 4: Cosmos parity vector (highest-value non-EVM)

Add a Cosmos bank-send case. Cosmos is where varint/fee-denom divergence is most likely (the
terra-classic bug class). If assembling a matching input for both families is non-trivial, capture a
real `KeysignPayload` from an existing core test fixture.

**Verify**: same as Step 2. If the RN Cosmos builder and WalletCore diverge, that is a likely-real
finding — report it prominently.

### Step 5: Wire into the suite

Ensure the new file runs under `yarn workspace @vultisig/sdk test` (and `yarn test:core` if placed in
core). Do not add it to any `skipIf`-gated path — it must run in CI unconditionally.

**Verify**: `yarn workspace @vultisig/sdk test` → all pass (or the parity failures are the reported
findings). `yarn typecheck` → exit 0.

## Test plan

- New file asserts byte-identical pre-signing hashes between the RN pure-JS builder and the
  WalletCore/`compileTx` path for: EVM native, ERC-20 transfer, Solana native, Cosmos bank-send.
- Reuse the existing RN golden constants as shared inputs so the two families are fed identical data.
- Model after `packages/core/mpc/tx/compile/compileTx.golden.test.ts`.
- Verification: `yarn workspace @vultisig/sdk test -- encoder-parity` → all pass, or documented
  divergence(s) reported.

## Done criteria

- [ ] `yarn typecheck` exits 0
- [ ] The new `encoder-parity` test file exists and runs in the default (non-skipped) test path
- [ ] Parity assertions for EVM native, ERC-20, Solana, Cosmos exist
- [ ] Either all parity tests pass, OR any failure is documented (input + both hashes + which family
      diverged) in the PR/report and `plans/README.md` row set accordingly
- [ ] No encoder source files modified (`git status` shows only the new test file)
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report (do not improvise) if:
- A parity assertion fails — capture the exact input, both hashes, and the diverging family. Do NOT
  "fix" it by changing an encoder or loosening the assertion. A real divergence is the most valuable
  possible outcome of this plan and needs its own risk-assessed fix plan.
- You cannot import both families from a single test file (a build/layering constraint) — report the
  constraint; the parity net may need a small test-only bridge, which is a design question for the
  maintainer.
- `getPreSigningHashes` / the WASM hash mechanism doesn't match what `compileTx.golden.test.ts` uses
  (drift) — re-read the golden test before proceeding.

## Maintenance notes

- This suite is the realization of the txbuilder-reconciliation recommendation ("golden-vector-bind
  the two encoders"). Once green, treat the WASM `compileTx`/prep output as the **reference oracle**:
  any new chain added to the RN pure-JS family must ship a parity vector here before it's trusted in
  a cross-device keysign.
- Extend to the chains most exercised by swaps/sends next (THORChain MsgDeposit, Tron, Ripple, Ton)
  — those lack any second-implementation cross-check today (SDK-TEST-03 in the report).
- A reviewer should confirm the test is NOT under any `skipIf`/fixture gate (unlike the e2e signing
  tests, which silently pass green when skipped — SDK-TEST-02).
