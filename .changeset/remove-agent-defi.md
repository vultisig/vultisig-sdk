---
'@vultisig/sdk': major
---

Remove the agent-focused DeFi namespace, builders, and `tools/defi` subpath from the wallet SDK, along with its exclusive `@balancer/sdk` dependency. Declare `@noble/ciphers` directly for the retained React Native encryption polyfills.
