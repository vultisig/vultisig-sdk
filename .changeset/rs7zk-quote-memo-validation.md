---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(swap): surface non-integer dstAmount drops + validate THORChain/MayaChain MsgDeposit memos (SDK-CORRECTNESS-04/06/08) — a drifted provider's non-integer `dstAmount` used to silently drop that quote from ranking with no signal it was a parse failure; `findSwapQuote` now `console.warn`s the provider + raw value before rethrowing. `prepareThorchainMsgDepositTxFromKeys` accepted an arbitrary memo string with no structural validation, unlike the fully-validated limit-swap memo path; it now fails closed on non-printable/oversized memos and unrecognized THORChain/MayaChain deposit actions (and, for the two documented LP actions, a malformed pool id), while still accepting non-LP operator-style memos (BOND, UNBOND, etc.) verbatim. Also replaced an `as any` cast on the deposit's chain-specific proto binding with per-chain branches so the `case`/`value` pairing is statically checked instead of bypassed.
