---
'@vultisig/sdk': minor
---

Add `sdk.balance.polkadot(...)` — a pure-crypto, RN-safe Polkadot balance reader.

- `balancePolkadot({ address })` returns the full native DOT `pallet_balances`
  breakdown (free / reserved / frozen / total / spendable + nonce), parsed from
  the raw SCALE `AccountInfo` blob via `state_getStorage` (no `@polkadot/api`).
- `balancePolkadot({ address, assetId })` returns an Asset-Hub `pallet_assets`
  asset balance (raw u128 base units; USDT id=1984, USDC id=1337, …).
- Hard SS58 prefix=0 + checksum + EVM-hex gate so a Bittensor / Kusama / typo'd
  address can't silently resolve to the wrong-account Polkadot balance.

Exposed on both the generic entry and the React Native entry (the latter via a
lazy dynamic import to keep `@polkadot/api` out of the eager RN bundle).
