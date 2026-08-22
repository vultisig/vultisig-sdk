---
'@vultisig/sdk': patch
---

Fix Skip route bech32 address validation accepting a wrong-chain recipient on Akash (`akashnet-2`) routes — the local HRP allowlist was missing the `akash1` entry, so validation fell back to generic bech32-shape acceptance instead of checking the actual chain prefix.
