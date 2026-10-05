---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Stop reporting a Cardano broadcast as failed when another signing device already sent the same transaction. Every device in a keysign broadcasts the same bytes, and the node now answers the later ones with a mempool rejection (code 3997, "All inputs are spent. Transaction has probably already been included") instead of code 3117. The fallback hash lookup gave up after about 3 seconds, before the first copy could be in a block, so the device that lost the race showed "Failed to broadcast transaction" for a transaction that went through.

That reply does not prove the transaction is the one that spent the inputs, so it is not accepted on its own. It now makes the hash lookup wait long enough for the next block (up to about two minutes): the broadcast is reported as sent once the hash is seen, and as failed if it never appears. The node's justification also replaces the message that only pointed at it ("A justification is given as 'data.error'").
