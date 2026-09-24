---
"@vultisig/sdk": patch
"@vultisig/cli": patch
'@vultisig/core-chain': patch
---

Reject mixed-case EVM recipient addresses whose EIP-55 checksum does not match. WalletCore accepted any `0x` + 40 hex regardless of letter case, so a one-character typo in a checksummed address passed `send`, max-send, fee estimation and `address-book --add`. All-lowercase and all-uppercase addresses are still accepted; the invalid-address error now names the checksum mismatch so it does not read as a formatting problem. `isValidTokenId` for EVM chains is now checksum-strict for mixed-case ids as well; the built-in token registry was corrected accordingly.
