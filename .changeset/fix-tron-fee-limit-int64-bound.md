---
'@vultisig/sdk': patch
---

Fix Tron `fee_limit` silently corrupting above protobuf `int64` range. `prepareTrc20TransferFromKeys` and `buildTrc20TransferTx` accepted any positive `feeLimitSun` / `feeLimit`, and `encodeInt64Varint` passed values >= 2^63 straight to the unsigned varint encoder - so the bytes a node decodes back were a different number entirely (2^63 read back as `-9223372036854775808`, 2^70 read back as `0`, the latter silently re-entering the zero-fee_limit `OUT_OF_ENERGY` case the `> 0` guard exists to prevent). All three now fail closed at the int64 bound; `int64` max itself remains valid and round-trips unchanged.
