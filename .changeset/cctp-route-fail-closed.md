---
"@vultisig/sdk": major
---

Make `buildCctpBridge` asynchronous and fail closed before returning USDC approve or burn transactions. Callers must now use `await buildCctpBridge(params)` and handle rejected promises, including input-validation errors. The builder checks the registered destination MessageTransmitter with `eth_getCode`; missing/invalid code, RPC failure or a 20-second timeout rejects with `CctpRouteUnavailableError`. No signing or broadcasting occurs.

Use `createCctpBridgeSession()` and pass its opaque handle as `params.session` to reuse successful checks by canonical destination chain and transmitter address during one wallet/quote session. Discard the handle when that session ends; a new handle starts uncached. Configured RPC client changes force a recheck. Failed or timed-out checks are never cached. Without a session, every build performs a fresh check.
