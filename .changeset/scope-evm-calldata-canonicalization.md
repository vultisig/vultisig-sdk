---
'@vultisig/cli': patch
---

Scope the broadcast-journal empty-calldata canonicalization (`"0x"` → `""`) to EVM calldata only. `intent.data` also carries non-EVM memos, so canonicalizing it for every intent made a real memo of `"0x"` collide with an empty memo and falsely dedupe two different memo-chain sends inside the double-spend guard window. The fingerprint now folds `"0x"` only when the intent marks its data as EVM calldata, and every intent builder derives that mark from the chain kind (`getChainKind(chain) === 'evm'`): an EVM `"0x"` memo is empty calldata and still folds (so cross-path dedup is preserved), while a `"0x"` memo on a memo-routed chain stays distinct from an empty memo.
