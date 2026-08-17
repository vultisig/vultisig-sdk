---
'@vultisig/sdk': patch
---

Reject Polkadot asset-send amounts above pallet_assets `u128` and TRON TRC-20 fee limits above protobuf `int64` (at both the prep and raw-builder layers) instead of silently truncating or overflowing. Closes #1827, #1828.
