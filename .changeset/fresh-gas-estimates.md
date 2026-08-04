---
'@vultisig/cli': patch
---

Replace unavailable Ethereum and Polygon gas-refresh RPC endpoints, warn when pre-sign gas or nonce refreshes fail, and preserve nonce-gap safeguards when a pending-nonce lookup fails. Ethereum and Polygon pending-nonce checks now share the vault address and request timing with PublicNode.
