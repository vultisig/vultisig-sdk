---
'@vultisig/sdk': minor
---

Export the shared `chains` tx-builder namespace from the Node, browser, electron-main and chrome-extension entrypoints. `src/index.ts` documents the Cosmos signing primitives as shipping via `chains.cosmos.buildCosmosStakingTx` "from the platform-specific entry point", but only the React Native entry actually exposed it - leaving every other first-party consumer to deep-import or re-glue the builders. All five entries now hand out the same namespace object.
