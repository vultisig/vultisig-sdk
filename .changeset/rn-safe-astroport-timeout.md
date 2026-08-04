---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Fix the Astroport swap builder to use a React Native / Hermes-safe fetch timeout instead of `AbortSignal.timeout()`.
