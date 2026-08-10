---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Fail closed when LI.FI returns a destination outside its official chain-scoped Diamond deployments. Require independent benign Blockaid reputation verdicts for SwapKit EVM transaction destinations and approval spenders at quote construction and on the co-signer path, while retaining response-local target-address binding as defense in depth.

**Consumer-visible behavior changes:**

- **New runtime throws on the signing path.** A LI.FI destination outside the official Diamond, or a SwapKit destination/approval-spender that doesn't clear an independent Blockaid check, now throws during quote construction AND during co-signer signing-input construction (where none of these code paths could throw before). A consumer on a caret range picks this up automatically.
- **The SwapKit signing path now makes a live third-party network call (Blockaid) during MPC signing**, per co-signer, per swap with an ERC-20 approval. This is the first place in the repo a Blockaid verdict hard-refuses rather than being handed back to the caller as advisory; a slow or unreachable Blockaid response can stall a signing ceremony for up to the shared `queryUrl` timeout (20s default) before throwing.
