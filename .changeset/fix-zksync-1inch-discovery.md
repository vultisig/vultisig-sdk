---
"@vultisig/sdk": patch
---

fix(evm): add zkSync to the 1inch-supported chains so its ERC-20s are discovered. zkSync was silently absent from `oneInchSupportedChains`, so token discovery returned an empty set even though the proxy serves chain 324.
