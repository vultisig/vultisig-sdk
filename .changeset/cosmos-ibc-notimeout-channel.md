---
'@vultisig/sdk': patch
---

fix(cosmos): refuse to sign a no-timeout IBC transfer and validate the source channel

The Cosmos `IBC_TRANSFER` signing-input resolver built a `MsgTransfer` with an all-zero timeout (`timeoutTimestamp=0` and `timeoutHeight={0,0}`) whenever the IBC denom trace was missing. Relayers accept a no-timeout packet, but it never expires, so a failed transfer can leave funds stuck indefinitely instead of unwinding. The resolver now fails closed and refuses to build when neither timeout is usable (COSMOS-01). It also validates that the source channel parsed out of the memo (`<prefix>:channel-<n>[:...]`) is well-formed, refusing to sign with an undefined/empty/malformed channel instead of dispatching a broken `MsgTransfer` (COSMOS-03).
