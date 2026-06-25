---
'@vultisig/sdk': minor
---

Add `sdk.prep.trc20Transfer` (`prepareTrc20TransferFromKeys`): a pure-crypto,
vault-free builder for an unsigned TRON TRC-20 token transfer. ABI-encodes
`transfer(address,uint256)` with checksum-verified base58check address decoding
and a uint256 range guard, returning an `UnsignedTrc20Transfer` descriptor (no
signing, no RPC, no broadcast). Exported from the package barrel and the
React Native entry so mcp-ts / agent-backend / Windows / Station can consume one
reviewed TRC-20 calldata implementation.
