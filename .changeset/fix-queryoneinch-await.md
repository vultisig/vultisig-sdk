---
"@vultisig/core-chain": patch
---

fix: await assertFetchResponse in queryOneInch to prevent "Already read" body error

assertFetchResponse is an async function that reads the response body. Without
await, the body read started in the background while response.json() was called
concurrently - resulting in a "Already read" TypeError on non-2xx EVM discovery
responses. Fixes dashboard_sdk_discovery_failure events for Ethereum/BSC/Arbitrum.
