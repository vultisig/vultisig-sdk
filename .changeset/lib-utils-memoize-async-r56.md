---
'@vultisig/lib-utils': patch
'@vultisig/sdk': patch
---

Centralize the race-safe `memoizeAsync` implementation in `@vultisig/lib-utils`, and update the SDK browser/chrome-extension runtimes to consume the shared helper so concurrent initialization work shares in-flight promises instead of duplicating async setup.
