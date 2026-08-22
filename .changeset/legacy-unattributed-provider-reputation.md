---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Close the last bare log-only bypass on the co-signer swap guards: a payload relabelled with the legacy unattributed (`''`) provider string previously skipped every fund-safety check regardless of its destination. A `''`-labelled destination that already matches a known enforced aggregator router (true of every real historical mobile fixture) stays log-only; anything else now requires the same independent Blockaid reputation verdict SwapKit destinations already use, applied to both the swap-leg destination and the ERC-20 approval spender.

**Consumer-visible behavior changes:**

- **New runtime throws on the signing path.** A `''`-provider swap-leg destination or approval spender that is neither a known aggregator router nor Blockaid-benign now throws during co-signer signing-input construction. A consumer on a caret range picks this up automatically.
- **A `''`-provider destination/spender outside the known-router allowlist adds a live third-party network call (Blockaid) during MPC signing**, per co-signer, mirroring the SwapKit behavior already shipped.
