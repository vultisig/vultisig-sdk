---
'@vultisig/sdk': minor
'@vultisig/cli': patch
---

Hoist tool-output → signable-candidate derivation into `@vultisig/sdk` (`deriveToolOutputCandidate` and the fail-closed allowlists). CLI keeps the same import path as a thin re-export so consumers no longer have to copy CLI-local chain/field-name guards.
