---
'@vultisig/sdk': patch
---

fix(ripple): verify on-ledger inclusion for ambiguous XRP submit results instead of a blind throw

`submitXrpTx` (the app's only XRP broadcast call site) threw a generic error for every `tec*` engine result from XRPL's `submit`, even though `tec*` means the tx was applied on-ledger (fee + sequence consumed) and the requested operation itself failed. A caller that treated that as "never broadcast" and retried with the same sequence risked a `tefPAST_SEQ` or a fund-loss race on a fee change.

`submitXrpTx` now looks up `tec*` transactions by hash before deciding, and throws a typed `XrpSubmitRejectedError` with `.reason` for confirmed on-ledger failures, pending validation, and unconfirmed lookups. It also classifies `tef*` and non-queued `ter*` submit results conservatively instead of reporting them as safe local/preflight rejections. Only `tem*`/`tel*` local preflight failures are now reported as `'not-on-ledger'`. Also fixes the stale doc comment claiming the helper is unused by app code.
