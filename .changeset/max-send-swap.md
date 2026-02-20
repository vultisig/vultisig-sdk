---
'@vultisig/sdk': minor
'@vultisig/cli': minor
---

Add max send/swap support across SDK, CLI, and example apps

- Add `vault.getMaxSendAmount()` returning `{ balance, fee, maxSendable }` for fee-accurate max sends
- Add `vault.estimateSendFee()` for gas estimation without max calculation
- Enrich `getSwapQuote()` with `balance` and `maxSwapable` fields
- CLI: Add `--max` flag to `send`, `swap`, and `swap-quote` commands
- Browser/Electron examples: Add "Max" button to Send and Swap screens
- Fix native token ticker resolution in example swap UI (was using chain name instead of ticker)
