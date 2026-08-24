---
'@vultisig/sdk': patch
---

Restore Cosmos governance parity with the agent backend by accepting Sei, Injective, Neutron, Celestia, and Stride (including their chain IDs) for proposal reads and unsigned vote preparation. Terra Classic `gov/v1beta1` proposal filters now use the required integer enum values instead of `PROPOSAL_STATUS_*` strings.
