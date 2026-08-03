---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Limit-order cancellation primitives: the `m=<` modify-limit-swap memo in its cancel form, eligibility, bucket-key duplicate detection, and L1 dust.

Cancellation is not a variation on placement. Every failure mode is silent — the transaction confirms, the fee is spent, and the order carries on resting with nothing to distinguish it from success — so each rule is enforced rather than documented.

`buildCancelLimitSwapMemo` refuses abbreviated assets outright: `ModifyLimitSwapMemo` is the one inbound memo type `processOneTxIn` does not run through `fuzzyAssetMatch`, so the placement memo's six-character contract suffix would address a bucket that by construction holds no order. Amounts are emitted as plain decimal integers, never compressed — these coins parse through `cosmos.ParseCoins`, which does not understand the scientific notation a placement LIM may use.

`getLimitSwapCancelEligibility` fails closed at every unknown and cross-checks what was recorded at signing against what the queue reports — **assets as well as amounts**. Absence is not disagreement (an order placed seconds ago has not been polled), but a present-and-unparseable observation blocks exactly as a mismatch does.

`getThorchainLimitOrderBucketKey` reproduces the advanced-swap-queue index key, including its zero-padding *and* right-truncation at 18 characters. Orders are addressed by `(layer-1 pair, ratio) + FromAddress` and the first match in the bucket wins, so orders sharing a ratio are not independently cancellable — compared on the key rather than on equal amounts, which would under-report collisions.

`getLimitSwapCancelDust` rescales the live `dust_threshold` from THORChain's 1e8 into the source coin's own precision, with a safety multiple and an upper ceiling, refusing rather than defaulting when the threshold is missing, unparseable, or rounds away. A cancel once signed for 2000 wei — the 1e8 threshold used verbatim as an 18-decimal chain's smallest unit — was truncated to zero and never observed; that case is pinned by a test.
