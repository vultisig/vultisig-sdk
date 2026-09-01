---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': major
'@vultisig/sdk': minor
---

fix(ton): one correct comment validator, run before the user signs

TON comment length was checked against a fixed 123 bytes wherever it was checked at all. That number is right for a native transfer, where the comment is the message body's own cell, and wrong for a jetton transfer, where the comment rides inline in the transfer body's `forward_payload` and shares one 1023-bit cell with the opcode, query id, amount, both addresses and the forward amount. The real jetton cap is roughly 34–39 bytes and SHRINKS as the amount grows, because `VarUInteger 16` widens a byte at a time. Anything above it reached WalletCore, which refuses to pack the cell and fails the keysign with a bare "Internal error" — after the user had reviewed and approved the transaction. Memos are load-bearing on TON; an exchange deposit without the right one loses the funds.

New `@vultisig/core-chain/chains/ton/comment` owns the rule for both shapes: `tonNativeCommentMaxBytes`, `getTonJettonCommentMaxBytes({ amount, isActiveDestination })`, `getTonCommentMaxBytes` for a send form that wants to count down against the real limit, and `validateTonComment`. The amount-dependent widths are measured by encoding them, not predicted, and a test drives real WalletCore at each cap and one byte past it to prove the two agree.

`buildSendKeysignPayload` now validates the memo at the end of the build, where the final signed amount and `isActiveDestination` are both known, and raises a non-retryable `BuildKeysignPayloadError('ton-memo-too-long')`. That moves the failure from keysign to the point where the payload is assembled — the verify screen — for every consumer, with no client-side change. The signing-input resolvers still validate, so a payload built by another device or an older client cannot get an unpackable comment signed here either.

**Breaking:** `validateTonComment` is no longer exported from `@vultisig/core-mpc/keysign/signingInputs/resolvers/ton/native`, and takes `{ memo, jetton? }` instead of a bare string. Import it from `@vultisig/core-chain/chains/ton/comment`. `validateTonMemo` in the SDK's TON surface keeps its signature and gains an optional second argument for jetton context.
