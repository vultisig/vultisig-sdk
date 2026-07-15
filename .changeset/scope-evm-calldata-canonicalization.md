---
'@vultisig/cli': patch
---

Scope the broadcast-journal empty-calldata canonicalization (`"0x"` → `""`) to EVM calldata only. `intent.data` also carries non-EVM memos, so canonicalizing it for every intent made a real memo of `"0x"` collide with an empty memo and falsely dedupe two different memo-chain sends inside the double-spend guard window. The fingerprint now folds `"0x"` only when the intent marks its data as EVM calldata; a memo of `"0x"` stays distinct from an empty memo.
