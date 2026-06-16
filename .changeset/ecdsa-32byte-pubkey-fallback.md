---
"@vultisig/core-chain": patch
---

fix(pubkey): fall back to bip32 derivation when chainPublicKey is 32 bytes on ecdsa chains

Older KeyImport vault backups sometimes store the raw 32-byte X coordinate
for secp256k1 chains instead of the standard 33-byte compressed form.
WalletCore's createWithData rejects these with "Invalid length: Expected 33
but received 32", breaking execute_swap / show_receive_request for affected
users (~7 events/day in prod).

The fix detects the 32-byte case at runtime for ecdsa chains and falls back
to BIP32 derivation from the root ECDSA key, which always produces a valid
33-byte compressed pubkey.
