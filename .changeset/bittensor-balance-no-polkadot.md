---
'@vultisig/core-chain': patch
---

fix(bittensor): drop polkadot dynamic import in balance resolver

The Bittensor balance resolver dynamically imported `@polkadot/util-crypto`
just to base58-decode an SS58 address, blake2_128-hash the pubkey, and
hex-encode it. In browser/extension bundles this dynamic import pulls in
a chunk that double-bundles BN.js; the second copy throws
`TypeError: Cannot assign to read only property 'toString' of object '#<o>'`
during module init, so every TAO balance fetch fails with no useful
network/console signal — the chain page only renders "Failed to load".

The resolver now uses the libraries already in `@vultisig/core-chain`'s
direct dependency set: `@noble/hashes` for `blake2b` and `bytesToHex`, and
`bs58` for the SS58 base58 decode. No polkadot, no `Buffer`, no dynamic
imports. Bittensor uses SS58 prefix 42 (1-byte network prefix + 32-byte
pubkey + 2-byte checksum = 35 bytes); we slice `[1, 33)` to recover the
pubkey, then build the storage key and call `state_getStorage` exactly
as before.

Behaviour for valid SS58 addresses is unchanged. Invalid-length
addresses now throw a clearer `Invalid SS58 address length` error
instead of a polkadot decoding error.
