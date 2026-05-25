---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
'@vultisig/sdk': minor
---

## New

- Polkadot Asset Hub USDT (asset_id 1984) + USDC (asset_id 1337) token registry (#562)
- Polkadot `pallet_assets.Account` balance resolver for Asset Hub tokens - replaces placeholder 0n guard (#563)
- Tron native send `data` field (proto field 12) for THORChain memos + exchange deposit memos; `BuildTronSendOptions` and `BuildTrc20TransferOptions` gain optional `data?: Uint8Array` field (#559)

## Fixed

- Tron TRC-20 fee estimate now subtracts sender's available energy before charging TRX (#556)
- Tron native send free bandwidth check prevents spurious fee charge when bandwidth is available (#555)
