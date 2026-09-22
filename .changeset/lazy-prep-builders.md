---
"@vultisig/sdk": patch
---

Defer transaction builders until asynchronous prep helpers run, allowing the canonical prep barrel to load without initializing unrelated chain builders.
