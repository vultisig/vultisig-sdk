---
'@vultisig/core-chain': patch
---

Remove i18next dependency from `getNativeSwapQuote` — the lone `t()` call was the only i18next usage in the entire chain package, and consuming apps that don't initialize i18next (or initialize it without a Backend plugin) crash with `Cannot read property 'reload' of undefined` whenever code touches the SDK swap path. Replaced with a plain English fallback string. Drops i18next from `dependencies`.
