---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Fund a Cardano native-token (CNT) recipient output with a min-UTxO-satisfying lovelace floor instead of reusing the token quantity as the ADA amount. `keysignPayload.toAmount` for a CNT send is the token's own base-unit quantity, not lovelace; passing it straight through to `transferMessage.amount` produced outputs like 0.665 ADA for a 0.665 USDM send — below Cardano's min-UTxO requirement, so the network rejected the tx post-keysign (Ogmios 3125 "insufficiently funded outputs") after both co-signers had already converged on signing the doomed body.
