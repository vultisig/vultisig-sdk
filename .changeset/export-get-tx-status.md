---
'@vultisig/sdk': patch
---

`@vultisig/sdk`: re-export `getTxStatus` from `@vultisig/core-chain/tx/status` as a top-level standalone helper alongside `getCoinBalance` and `getPublicKey`. The dispatcher is stateless (`{ chain, hash }` → `TxStatusResult`) and was already compiled into every platform bundle, but was previously only reachable via the `vault.getTxStatus(...)` instance method on `VaultBase`. Vault-free callers (CLI, RN apps that store vault data outside `VaultManager`) can now poll receipts without instantiating an abstract `VaultBase` subclass purely to use a stateless lookup. `TxStatusResult` / `TxReceiptInfo` were already exported as types — this just adds the runtime function.
