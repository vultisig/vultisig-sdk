---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ton): stop hiding action-phase failures on sends and in status

Every TON send OR'd `IGNORE_ACTION_PHASE_ERRORS` into the wallet contract's send mode, which tells the contract to skip an outgoing transfer it cannot carry out instead of failing. The transaction then landed un-aborted with the seqno consumed and nothing moved, and the status resolver — which read only `aborted` and `compute_ph.exit_code` — reported it as confirmed. The user was told a transfer succeeded while the funds never left.

The flag is now dropped from native, MAX, dApp `signTon`, and Jetton sends (both the WalletCore and the React Native builders), and `getTonTxStatus` reads the action phase (`success`, `no_funds`, `result_code`, `skipped_actions`) alongside the compute phase. A transaction the indexer knows but has not yet described stays pending instead of counting as success.

Dropping the flag changes the signed body, so TON signing hashes move. Clients must upgrade together: a co-signer on an older build derives a different hash and the keysign fails. The mobile and cross-encoder golden corpora are re-recorded to the new values.
