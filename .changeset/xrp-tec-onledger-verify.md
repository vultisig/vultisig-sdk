---
'@vultisig/sdk': patch
---

fix(ripple): verify on-ledger inclusion for tec\* submit results instead of a blind throw

`submitXrpTx` (the app's only XRP broadcast call site) threw a generic error for every `tec*` engine result from XRPL's `submit`, even though `tec*` means the tx was applied on-ledger (fee + sequence consumed) and the requested operation itself failed. A caller that treated that as "never broadcast" and retried with the same sequence risked a `tefPAST_SEQ` or a fund-loss race on a fee change. `submitXrpTx` now looks up the tx by hash before deciding, and throws a new typed `XrpSubmitRejectedError` distinguishing three outcomes via `.reason`: `'on-ledger-tec'` (confirmed applied on-ledger, fee/sequence consumed, do not retry with the same sequence), `'pending-validation'` (found by hash but not yet in a validated ledger — transient, not a hard failure), and `'not-on-ledger'` (never landed, safe to retry — the fund-safe default when the lookup can't confirm either way). Also fixes the stale doc comment claiming the helper is unused by app code.
