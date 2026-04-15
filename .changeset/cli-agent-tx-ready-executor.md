---
'@vultisig/cli': patch
'@vultisig/sdk': patch
---

fix(cli): align agent executor with backend payloads and harden action handling

- model `tx_ready` / non-streaming transaction payloads with `TxReadyPayload`
- optional `vultisig` on agent config for shared SDK state (e.g. address book)
- executor improvements (chain locks, calldata resolution, EVM gas refresh) and unit tests
