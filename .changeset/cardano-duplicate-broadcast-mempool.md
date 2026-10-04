---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Stop reporting a Cardano broadcast as failed when another signing device already sent the same transaction. Every device in a keysign broadcasts the same bytes, and the node now answers the later ones with a mempool rejection (code 3997, "All inputs are spent. Transaction has probably already been included") instead of code 3117. Only 3117 was recognised, and the fallback hash lookup gives up after a few seconds — before the first copy can be in a block — so the device that lost the race showed "Failed to broadcast transaction" for a transaction that went through. That reply is now treated as already broadcast and resolves to the locally computed hash, as on Android. The node's justification also replaces the message that only pointed at it ("A justification is given as 'data.error'").
