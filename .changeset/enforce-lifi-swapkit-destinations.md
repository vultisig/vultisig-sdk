---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Fail closed when LI.FI returns a destination outside its official chain-scoped Diamond deployments. Accept that Diamond as LI.FI's deterministic approval-spender fast path, while requiring an independent benign Blockaid verdict for any route-dependent spender that differs from it. Require the same independent verdicts for SwapKit EVM transaction destinations and approval spenders, while retaining response-local target-address binding as defense in depth.

**Consumer-visible behavior changes:**

- **New runtime throws on the signing path.** A LI.FI destination outside the official Diamond, a distinct LI.FI approval spender that doesn't clear an independent Blockaid check, or a SwapKit destination/approval-spender that doesn't clear the same check now throws during quote construction and co-signer signing-input construction. A consumer on a caret range picks this up automatically.
- **Dynamic LI.FI approval spenders and SwapKit addresses add a live third-party network call (Blockaid) during MPC signing**, per co-signer. The official LI.FI Diamond remains an offline fast path. A slow or unreachable Blockaid response can stall a signing ceremony for up to the shared `queryUrl` timeout (20s default) before throwing.
