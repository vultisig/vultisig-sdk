---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

feat(ripple): add XRPL issued-currency (custom token) support

XRPL issued currencies (trust-line tokens / IOUs) had no token metadata resolver,
so custom tokens could not be added on Ripple. Adds `getRippleTokenMetadata` and
registers Ripple in `chainsWithTokenMetadataDiscovery`. Unlike EVM/Tron there is no
on-ledger metadata call: XRPL exposes no per-token decimal metadata — so the SDK
applies its fixed issued-currency decimal policy (`rippleIssuedCurrencyDecimals`) —
and the ticker is derived from the currency code, so the resolver fetches nothing.
Curated tokens
(RLUSD) get their logo and price provider merged in; an arbitrary token gets neither
rather than borrowing a known token's identity, since two issuers can share a ticker
on XRPL.

`isValidTokenId` now also accepts a human ticker (`SOLO`, `RLUSD`) wherever an
on-ledger currency code is accepted — the form shown on explorers like xrpscan — and
a new `normalizeTokenId` canonicalises a pasted id to the on-ledger form.

`BalanceService.addToken`/`removeToken` normalise the token id (and its matching
`contractAddress`) before it enters persisted state, so a manually added
`RLUSD.<issuer>` collapses onto the canonical `524C…<issuer>` that ledger discovery
stores instead of being kept as a second, distinct token. A no-op for chains whose
ids are already canonical.
