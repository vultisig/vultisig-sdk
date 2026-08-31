---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ton): derive each dApp message's bounce flag from its own destination

A dApp `signTon` batch stamped every message with the single wallet-level `TonSpecific.bounceable`, which the chain-specific resolver computes from the first message's destination alone. The bounce bit a message declares lives in its own address tag — `EQ…`/`kQ…` bounceable, `UQ…`/`0Q…` not, a raw `workchain:hex` address none — so a batch with mixed destinations, or a first destination that is not yet deployed, signed the wrong bit on some of its messages, and a co-signer deriving the flag per address computed a different hash for the same payload.

Each dApp message now takes the flag from its own destination (`getTonMessageBounceable` in `@vultisig/core-chain/chains/ton/messageBounce`); a raw address is non-bounceable, the usual shape of a deployment. App-initiated single sends are unchanged and keep the wallet-level flag and the nominator-pool override.

The bounce bit is part of the signed body, so TON signing hashes move for dApp batches whose destinations do not all share the first message's flag. Co-signers must apply the same per-message rule.
