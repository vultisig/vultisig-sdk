---
'@vultisig/cli': patch
---

The CLI's pre-sign consent line now renders ERC-20 approve legs from the signed calldata (spender and allowance), never from producer labels. Single-leg approves say so explicitly, multi-leg envelopes name the approve leg, unlimited allowances render as UNLIMITED, and an approval leg whose calldata is not an ERC-20 approve fails closed.
