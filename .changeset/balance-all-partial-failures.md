---
'@vultisig/cli': patch
---

fix(portfolio): report per-chain failures instead of silently swallowing them. The `portfolio` command now fetches each chain independently — one unreachable chain no longer fails the whole command, and a fiat-value lookup failure no longer silently drops the value. The `-o json` envelope always carries a `failures: [{ chain, stage, error }]` array (empty on full success), partial failures still exit 0, and an all-chains-failed run exits with a network error (code 3).
