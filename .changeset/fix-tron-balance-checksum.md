---
"@vultisig/sdk": patch
---

fix(tron): verify the base58check checksum on the TRC-20 balance-read address decode. `tronAddressToAbiParam` used plain `bs58.decode` with no checksum check, so a typo'd-but-decodable address silently queried a different account; it now uses `bs58check.decode`.
