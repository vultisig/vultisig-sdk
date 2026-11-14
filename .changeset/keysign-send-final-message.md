---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Signing no longer stalls when one relay poll returns several peer messages at once. Before, `keysign` stopped sending as soon as the local side finished, so its last message could be left unsent. The peer never finished, and the next message of the transaction timed out after 3 minutes. This most often broke fast-vault UTXO transactions with many inputs, and it could also hit EdDSA and multi-device signing. Every outbound message is now sent right after the input that produced it. A failed relay send now fails `keysign` instead of stalling until the timeout.
