---
'@vultisig/sdk': patch
---

`buildSplTransfer` now rejects known Solana burn/program destinations (System Program, SPL Token Program, Wrapped SOL mint, Incinerator) via the shared `assertSafeDestination` guard, closing a gap where its native-SOL sibling `prepareSendTxFromKeys` (guarded since #1698) rejected these but the SPL token path did not.
