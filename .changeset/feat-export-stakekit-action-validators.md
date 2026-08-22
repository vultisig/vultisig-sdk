---
'@vultisig/sdk': minor
---

Export `validateStakekitActionAddress` and `validateStakekitActionInput` from the public SDK surfaces (root, `tools`, and the React Native entry). Both are pure canonicals already used internally by the StakeKit builders and already test-covered, but they were stranded inside the module - so consumers kept re-declaring the same address/amount preflight rules after the SDK had ported them.
