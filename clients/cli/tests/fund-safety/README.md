# Fund-safety regression suite

Scripted, opt-in, real-mainnet broadcast verification for sdk-cli's
sign + broadcast layer. Catches the **silent-broadcast bug class** —
where the pipeline returns a "success" hash for a tx that never landed
on-chain (canonical example: vultisig-sdk #458, Ripple `temREDUNDANT`).

## Why sdk-cli

It's the only client positioned for scripted broadcast-with-verification:
vultiagent has emulator E2E (hard to script), agent-backend has unit
tests (no signing), mcp has unit tests on tool emissions (no broadcast).
sdk-cli has signing keys, can script broadcast, and can verify on-chain.
The agent-backend validator pipeline (#527) runs at the tool-call
boundary — it structurally cannot see sdk-cli's downstream
sign+broadcast layer, which is exactly where #458 lived.

## How it works

For each `(chain, scenario)`:

1. Drive `vsig agent ask "send X to <self>"` against a REAL funded vault.
2. Capture the broadcast id sdk-cli reports (EVM tx hash / SOL signature).
3. Independently verify via a **public RPC that is NOT sdk-cli's
   broadcast downstream** — so a proxy that silently swallows a
   malformed tx and reports success can't also fake the verification.
4. Assert: the id exists on-chain AND from/to/value/chainId match intent.
5. `hash returned but RPC says not-found` ⇒ **SILENT BROADCAST BUG**.

## Safety

- **Opt-in only.** Every test is gated on `FUND_SAFETY_E2E=1`. With it
  unset, the suite performs **zero broadcasts** (`describe.skipIf`).
  Defense-in-depth: the default `yarn test` also `--exclude`s
  `tests/fund-safety/**` at collection time.
- **Self-send only.** Tests send to the vault's own address. Never a
  placeholder / burn address.
- **Tiny amounts.** 0.0001 ETH (~$0.30 gas) / 0.0001 SOL (+fees).

## Running

```bash
cd clients/cli
yarn build               # dist/index.js must be current

# Dry run — assertions only, zero broadcasts. Expect: N skipped.
yarn vitest run tests/fund-safety/

# Full run — REAL mainnet broadcasts, ~$0.50–$1 total across chains.
yarn test:fund-safety
```

### Required setup before a full run

The vault must be configured in the CLI keyring (`vsig auth setup`) and
hold tiny mainnet balances:

| env var | default | purpose |
|---|---|---|
| `FUND_SAFETY_E2E` | _(unset)_ | `1` to enable broadcasts. Without it: skip. |
| `FUND_SAFETY_VAULT` | `Vultisig Cluster #1` | keyring vault name |
| `FUND_SAFETY_PASSWORD` | `password` | vault password |
| `FUND_SAFETY_ETH_ADDR` | `0x58C4…5C35` | ETH self-send recipient (vault's own) |
| `FUND_SAFETY_SOL_ADDR` | _(unset — required for SOL)_ | vault's Solana address. SOL test fails fast without it (hardened derivation — no guessing). |
| `FUND_SAFETY_BACKEND_URL` | _(prod abe.vultisig.com)_ | override agent-backend |

### Cost per full run

ETH ≈ $0.30 gas. SOL ≈ 0.0001 SOL + ~5000 lamports fee. Phase 1 total
well under $1. (Actual measured numbers tracked in the task file.)

### When to run

- Before each sdk-cli release.
- After any change to the sign / broadcast path
  (`packages/sdk/src/tools/prep/`, chain broadcast helpers, the agent
  executor's tx dispatch).

## Verifiers

Independent ground-truth endpoints (intentionally different from
sdk-cli's broadcast path):

| Chain | Endpoint | Method |
|---|---|---|
| Ethereum | `ethereum-rpc.publicnode.com` | `eth_getTransactionByHash` |
| Solana | `api.mainnet-beta.solana.com` | `getTransaction` (finalized) |

## Artifacts

Each run writes a forensic JSON to `last-run/<test>.json` (broadcast
capture, on-chain result, expected values). Inspect post-run when a
test fails or surprises. Not committed (gitignored).
