---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Zcash sends pay the ZIP 2009 fee: 1,000 zats per logical action instead of 5,000. ZIP 2009 lowered the conventional marginal fee at mainnet height 3,590,000 (2026-11-19). A plain 1-input, 2-output send now plans 2,034 zats instead of 10,000.

`zcashMarginalFee` is now 1,000. That alone changed nothing, because WalletCore's `zip_0317` planner hardcodes 5,000 per action and the constant was only a floor check on top of it. `getUtxoSigningInputs` therefore no longer uses that planner for Zcash. Every Zcash plan now runs in `byteFee` mode, starting at 1 zat/byte and raising `byteFee` until the fee clears the ZIP-317 conventional fee, which is the path memo sends already took.

This changes the signed Zcash transaction. iOS and Android co-signers have to plan the same way, or keysign digests diverge, so release it together with their ZIP 2009 changes.
