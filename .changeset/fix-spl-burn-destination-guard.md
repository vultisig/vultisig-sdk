---
'@vultisig/sdk': patch
---

Add the burn/program destination guard to `buildSplTransfer`. Its native sibling `prepareSendTxFromKeys` gained `assertSafeDestination` in #1698 and Solana is a covered family in `dangerousAddresses.ts`, but the SPL builder had none - so the two disagreed about destinations this SDK explicitly calls unrecoverable. The gap was not covered by the existing pubkey check: the Solana System Program and the SPL Token Program are both ON the ed25519 curve, so ATA derivation succeeded and a transfer to either built cleanly.
