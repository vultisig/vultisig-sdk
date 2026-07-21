---
'@vultisig/core-chain': patch
---

Fix the Bittensor broadcast assuming success on a malformed RPC response. `broadcastBittensorTx` only inspected `response.error`; a body with neither `error` nor `result` (truncated / malformed gateway response) fell through and returned `undefined` — reported as a successful broadcast. It now forces hash verification when `result` is absent, mirroring the Polkadot resolver's JSON-RPC 2.0 guard.
