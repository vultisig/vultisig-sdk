---
'@vultisig/core-chain': patch
---

Fix a `0X`-prefixed (uppercase-X) burn recipient slipping the custom-recipient
guard on native THOR/Maya cross-chain swaps.

`findSwapQuote`'s `isEvmAddress` shape check was case-sensitive on the `0x`
prefix, so a recipient like `0X000…dEaD` failed the check, skipped the
zero/burn-address branch, and — on a native route where the CowSwap format
gate is unreachable — passed straight through as the swap destination, an
unrecoverable sink. The gate is now case-insensitive on the prefix (`/i`),
matching the Go guard; the burn comparison already lowercases, so this only
closes the bypass without changing any accepted address.
