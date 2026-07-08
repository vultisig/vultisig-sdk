---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Stop `tx-status` from reporting malformed or never-seen transaction hashes as `pending` forever.

- The EVM status resolver now distinguishes a genuinely-pending tx (the node knows the hash, receipt still lagging) from one the node has never seen, returning a new terminal `not_found` status for the latter instead of an indefinite `pending`.
- New `isValidTxHash(chain, hash)` helper validates a hash's shape per chain-kind; the CLI `tx-status` command validates `--tx-hash` before any RPC and fails fast with `INVALID_INPUT` (exit 4) on a malformed hash.
- CLI `tx-status` polling is now bounded by a total wait budget (`--timeout <seconds>`, default 120) and exits non-zero on give-up — `TX_NOT_FOUND` (exit 5) when the node has no record of the hash, `TX_STATUS_TIMEOUT` (exit 3, retryable) when it is still pending.
- The poll loop now caps each sleep at the remaining wait budget instead of always sleeping the full poll interval, so a small `--timeout` gives up promptly instead of overshooting by up to one poll interval.
