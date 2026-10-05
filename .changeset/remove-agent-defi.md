---
'@vultisig/sdk': major
'@vultisig/core-chain': patch
---

Remove the agent-focused DeFi namespace, builders, and `tools/defi` subpath from the wallet SDK, along with its exclusive `@balancer/sdk` dependency. Declare `@noble/ciphers` directly for the retained React Native encryption polyfills. Load the Polkadot API when a Polkadot client is first requested so the SDK root no longer includes it in the eager wallet graph.
