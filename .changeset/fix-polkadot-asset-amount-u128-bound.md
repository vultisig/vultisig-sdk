---
'@vultisig/sdk': patch
---

Fix `preparePolkadotAssetSend` accepting an `amount` above `u128`. `pallet_assets.transferKeepAlive` encodes `amount` as a `u128`, but only a `> 0` check was applied - past `2^128-1` `compactToU8a` silently switches to compact big-integer mode and emits a payload wider than the slot the runtime decodes, so the on-device signer would sign a call body that cannot execute. Now bounded at `2^128-1`, mirroring the existing `ASSET_ID_MAX` guard in the same builder.
