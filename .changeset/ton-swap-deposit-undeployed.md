---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ton): send a swap deposit non-bounceable when nothing is deployed at the deposit address

A swap deposit was always sent bounceable so that a router or escrow contract that rejects it refunds it. A provider that hands out a fresh deposit address per swap has no contract there yet, and TON cannot deliver a bounceable message to an undeployed account: it returns the funds minus gas, so every such swap came straight back to the sender and never started.

The deployment check now runs before the swap rule. An undeployed destination goes out non-bounceable; a deployed one keeps bouncing on rejection, whatever the address tag declares. An account the indexer reports as `nonexist` (reached by a message, never deployed) counts as undeployed alongside `uninit`, for both the bounce flag and a Jetton transfer's destination-activity flag.
