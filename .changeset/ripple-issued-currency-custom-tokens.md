---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

feat(ripple): add XRPL issued-currency (custom token) support

XRPL issued currencies (trust-line tokens / IOUs) had no token metadata resolver,
so custom tokens could not be added on Ripple. Adds `getRippleTokenMetadata` and
registers Ripple in `chainsWithTokenMetadataDiscovery`. Unlike EVM/Tron there is no
on-ledger metadata call: issued amounts carry no fixed decimal count and the ticker
is derived from the currency code, so the resolver fetches nothing. Curated tokens
(RLUSD) get their logo and price provider merged in; an arbitrary token gets neither
rather than borrowing a known token's identity, since two issuers can share a ticker
on XRPL.

`isValidTokenId` now also accepts a human ticker (`SOLO`, `RLUSD`) wherever an
on-ledger currency code is accepted — the form shown on explorers like xrpscan — and
a new `normalizeTokenId` canonicalises a pasted id to the on-ledger form so a
manually added token dedupes against the same id ledger auto-discovery produces.
