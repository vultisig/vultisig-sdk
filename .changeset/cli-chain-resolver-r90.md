---
"@vultisig/cli": patch
---

Fix remaining CLI command call sites so invalid chain arguments fail through the shared typed chain resolver instead of being cast through as a Chain.
