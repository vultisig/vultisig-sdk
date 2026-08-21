---
'@vultisig/sdk': patch
---

Add `toPolicyEnvelope` / `policy.fromDecodedEnvelope` so consumers can feed `decodeFromToolResult()` output into the policy and invariant helpers without maintaining their own chain/amount adapter.

Fails closed on a non-`transfer` decoded `kind` (approve/contractCall/delegate/undelegate/unknown) instead of laundering it into a transfer-shaped, decoded envelope — an approve or contract call has no meaningful "recipient" for a plain-send comparison, and adapting it as one let it PASS against a mismatched claim. Rejects negative and non-numeric amount strings (previously a negative amount silently disabled the amount check rather than being treated as suspicious) without flipping `decoded` to `false` for the whole envelope, so an unparseable amount no longer masks unrelated recipient/chain/memo mismatches — it surfaces additively via the new `amountParseError` field instead. Also never throws on a non-string `amount` (matches `decodeFromToolResult`'s "never throws" contract).
