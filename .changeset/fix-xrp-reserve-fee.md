---
"@vultisig/sdk": patch
---

fix(ripple): add the XRP reserve to the send amount check, not the burned fee. The base reserve was added to `gas` (the burned Fee) instead of being enforced against the Amount, burning ~1 XRP per fresh-address send; the resolver now sets the network fee correctly and rejects a send below the reserve.
