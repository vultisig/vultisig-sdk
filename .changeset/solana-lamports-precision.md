---
'@vultisig/sdk': patch
---

Fail closed instead of silently rounding: `getSolBalance()`'s `lamports` field is now `number | null`, returning `null` once the exact u64 balance exceeds `Number.MAX_SAFE_INTEGER` instead of re-exposing a value already corrupted by `Number()` coercion. `lamportsRaw` (base-10 string) and `sol` (exact decimal string) remain lossless across the full range and are unaffected.
