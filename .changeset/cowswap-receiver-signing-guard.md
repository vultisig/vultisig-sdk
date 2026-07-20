---
'@vultisig/core-chain': patch
---

Re-check the CowSwap order receiver at the signing (EIP-712 digest construction) step, not only at quote time. `assertValidCustomRecipient` rejects a zero/burn/malformed receiver when a quote is built, but an MPC co-signer never sees the quote — it decodes a `cowswap-order:` blob from the KeysignPayload (shape-validated only) and builds the digest to sign. `buildCowSwapOrderTypedData` now refuses a zero, burn (`0x…dead`), or malformed-non-EVM receiver, so a hand-built payload can't be signed into an order that sends the buy tokens to an unrecoverable address. vultisig always sets an explicit receiver (never CowSwap's `address(0)` sentinel), so no legitimately-produced order is affected.
