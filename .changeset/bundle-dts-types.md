---
"@vultisig/sdk": patch
---

Inline all `@core/*` and `@lib/*` types into bundled `.d.ts` files so external consumers no longer get unresolved import paths. Fixes circular type resolution errors when the consuming workspace has its own `@core/*` packages.
