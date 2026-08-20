---
'@vultisig/sdk': minor
---

Expose the canonical StakeKit helpers (`parseActionDisplay`, `buildYieldActionScanRequest`, `validateStakekitActionAddress`, `validateStakekitActionInput`) on `sdk.defi.stakekit`, alongside the existing `search`/`details`/`balances`/`buildEnter`/`buildExit`/`buildManage` methods. Previously these canonical display/parser/validation helpers were only reachable via deep imports or the root/module exports; `sdk.defi.stakekit` silently omitted them, pushing consumers toward reimplementation. `validateStakekitActionAddress` and `validateStakekitActionInput` are also now exported as flat root exports (`buildYieldActionScanRequest` and `parseActionDisplay` were already exported at root).
