---
'@vultisig/core-mpc': patch
---

feat(mpc): env-gated diagnostic logging for relay-decrypt ghash tag investigation

Adds non-default-on diagnostic logging to `fromMpcServerMessage` and the
`receiveMessages` keysign relay loop, gated on `VULTISIG_DIAG_MPC_RELAY=1`.
Logs envelope shape (`body_len`, `decoded_len`, `nonce_hex`, first 32 bytes
of ciphertext) plus a `key_fingerprint` (sha256-truncated of decoded key
bytes, NOT raw key material) for cross-node correlation of the persistent
"aes/gcm: invalid ghash tag" failures. Behavior unchanged when the env flag
is absent.
