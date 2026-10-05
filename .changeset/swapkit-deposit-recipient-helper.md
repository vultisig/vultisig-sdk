---
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

feat(swap): expose the SwapKit deposit recipient a payload signs

`getKeysignSwapKitDepositRecipient` (`@vultisig/core-mpc/keysign/swap/getKeysignSwapKitDepositRecipient`)
returns the address a SwapKit ERC-20 deposit payload transfers the sold token
to, decoded from the calldata that gets signed, or undefined for any other
payload. The EVM signer and the fee quote both derive the deposit from it, so a
co-signer's Verify screen can show the same recipient the signature binds.

It reads `quote.tx.value` and `fromAmount` as plain decimal strings only and
refuses anything else (`''`, `0x0`, padded or signed values), as the iOS and
Android co-signers do, instead of letting `BigInt` coerce them to a number.
