---
'@vultisig/sdk': patch
---

Scope the StakeKit yield caches by API credential. `/yields/enabled` returns only the products a given project's API key may deposit into, but the cache key omitted the credential, so the first caller's allowed set was served to every other caller for the full 5-minute TTL. That both leaked one project's enabled products to another and hid products the second project actually had. Cache keys carry a truncated SHA-256 of the key, never the key itself.
