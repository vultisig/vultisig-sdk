---
'@vultisig/sdk': patch
---

fix(encoding): reject empty/malformed amounts in the 5 resolvers #1140 missed

#1140 closed the `BigInt('') -> 0n` fail-open class (proto3 defaults an unset
`toAmount` string to `''`, so a bare `BigInt()` silently builds a zero-amount
transfer) for the resolvers whose amounts feed proto 64-bit fields via
`toBoundedLong`. The same unguarded `BigInt(toAmount)` pattern remained in five
resolvers whose amounts are NOT proto 64-bit integers: Tron TRC20 (uint256
calldata bytes), Polkadot (u128 balance bytes), Bittensor (SCALE-compact u64),
Solana send (uint64, was still raw `BigInt` + `Long.fromString`) and Ripple
issued-currency trust lines (decimal-string value).

Adds `toBoundedBigInt` (`@vultisig/lib-utils/bigint/toBoundedBigInt`), the
bigint-returning sibling of `toBoundedLong` (which now delegates to it), with an
explicit bit width per target field so wide fields don't false-reject: Tron
TRC20 bounds at uint256, Polkadot at u128, Bittensor at u64 (subtensor `Balance`
is u64), Ripple issued-currency at u128, and Solana send routes through
`toBoundedLong { unsigned: true }`. Ripple's raw-JSON memo payment path, which
inlined `toAmount` unvalidated into the tx JSON, is guarded the same way as its
sibling Payment proto path. An unset/negative/non-decimal amount now throws a
`RangeError` instead of being silently co-signed as a zero-value transfer.
