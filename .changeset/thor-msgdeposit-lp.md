---
'@vultisig/sdk': minor
'@vultisig/cli': minor
---

feat(sdk/vault): `signMsgDeposit` for THORChain/MayaChain LP add/remove; sdk-cli dispatches LP memos through it

Adds `vault.signMsgDeposit({chain, amountBaseUnits, memo})` to `VaultBase`, building a `THORChainDeposit` cosmos message via the existing keysign pipeline (passes `isDeposit: true` through `getChainSpecific`). Memo is opaque pass-through — LP add (`+:POOL[:PAIRED]`), LP remove (`-:POOL:BPS[:ASSET]`), and any future deposit-style intent flow through the same surface.

sdk-cli's `signNonEvmServerTx` now dispatches THORChain/MayaChain MsgDeposit envelopes by memo prefix: `=:` continues to route through `vault.swap` (Phase D), `+:` and `-:` route through the new `signThorMsgDepositLp` → `vault.signMsgDeposit`. Unsupported prefixes (LOAN, BOND, etc.) throw `NotImplemented` with the offending memo in the error message. Phase E in the envelope-parity progression; previously these memos threw at `parseThorSwapMemo`.
