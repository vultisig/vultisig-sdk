---
'@vultisig/sdk': patch
---

fix(ripple): verify on-ledger inclusion for tec\* submit results instead of a blind throw

`submitXrpTx` (the app's only XRP broadcast call site) threw a generic error for every `tec*` engine result from XRPL's `submit`, even though `tec*` means the tx was applied on-ledger (fee + sequence consumed) and the requested operation itself failed. A caller that treated that as "never broadcast" and retried with the same sequence risked a `tefPAST_SEQ` or a fund-loss race on a fee change. `submitXrpTx` now looks up the tx by hash before deciding: a validated `tec*` result throws a message that says the fee/sequence were consumed on-ledger and warns against retrying with the same sequence, while an unconfirmed lookup keeps the original error unchanged. Also fixes the stale doc comment claiming the helper is unused by app code.
