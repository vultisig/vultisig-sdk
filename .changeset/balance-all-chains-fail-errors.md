---
'@vultisig/cli': patch
---

`balance` (all-chains) now fails the command instead of reporting success when every chain fails to fetch. Previously the all-chains sweep always ended with `spinner.succeed()` and a JSON envelope, so `{ balances: {}, failures: [...] }` came back as a success exit code even when nothing was fetched. It now mirrors `portfolio`'s existing contract: zero successful chains throws a retryable `NetworkError` (non-zero exit), while at least one successful chain still reports partial success with the failing chains listed under `failures`.
