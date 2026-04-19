---
'@vultisig/cli': minor
'@vultisig/client-shared': minor
'@vultisig/sdk': minor
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

feat(cli): agent-friendly CLI + new @vultisig/mcp package

## @vultisig/cli

- Auto-TTY JSON output (`--output`, `--ci`, `--quiet`, `--fields`, `--non-interactive`)
- Versioned `{ success, v: 1, data }` envelope and typed error envelope with exit codes 0-7
- Safety: fixed `swap`/`send`/`execute`/`rujira swap`/`rujira withdraw` auto-executing in JSON mode; `--yes` now required uniformly
- `--dry-run` coverage across all mutating commands
- `vsig schema` machine-readable command introspection
- Auth: replaced `keytar` with `@napi-rs/keyring`, encrypted-file fallback for headless environments (AES-256-GCM + async scrypt)

## @vultisig/client-shared (new package)

Shared client infrastructure for `@vultisig/cli` and `@vultisig/mcp`: auth setup, config store, credential store (keyring + file fallback), tool descriptions, vault discovery.

## @vultisig/sdk

- `VaultBase.send()` and `VaultBase.swap()` accept `amount: 'max'`
- `SwapService` rejects quotes with near-zero output to guard against bad provider routes
- `FiatValueService.fetchTokenPrice` returns `0` for non-EVM chains instead of throwing (effective behavior identical — `getPortfolioValue` already caught the throw)
- `ServerManager`: removed stdout `console.log` calls that corrupted JSON output; raised `waitForPeers` timeout from 30s to 120s and tightened poll interval from 2s to 500ms

## @vultisig/core-chain

- Narrowed EVM broadcast retry list to strings that genuinely indicate "same tx already in mempool under this hash" (`already known`, `transaction already exists`, `tx already in mempool`). Dropped strings that can silently swallow real broadcast failures (`nonce too low`, `transaction is temporarily banned`, `future transaction tries to replace pending`, `could not replace existing tx`)

## @vultisig/core-mpc

- `maxInboundWaitTime` raised from 1 to 3 minutes for flaky networks
- Added 100ms sleep in `processInbound` recursion to prevent hot-looping on empty inbound
- Setup message polling: same 10-second budget, polls 5× more often (50 × 200ms vs 10 × 1000ms)
