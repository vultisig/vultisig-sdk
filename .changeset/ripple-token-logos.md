---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

feat(ripple): resolve logos for XRPL issued currencies

Only curated issued currencies (RLUSD) carried a logo, so every other trust-line
token — SOLO, an issuer's USD, anything added by id or surfaced by ledger
discovery — resolved with no logo and rendered as a broken-image placeholder in
clients.

`getRippleTokenMetadata` now reads an uncurated token's official icon from the
XRPL token registry (xrplmeta), keyed by the `<currency>:<issuer>` pair. This is
the same shape as the EVM resolver reading `logoURI` from 1inch and the Solana
resolver returning `icon`; XRPL was the outlier because it has no on-ledger token
metadata registry of its own.

A curated token is unchanged: it keeps its bundled logo and price provider and
performs no lookup. An uncurated token may borrow an icon but never a curated
token's `priceProviderId` — two issuers can share a ticker on XRPL, so the issuer
is what identifies a token. The lookup fails soft: an unlisted token or an
unreachable registry still resolves, just without a logo.
