---
'@vultisig/core-chain': minor
---

feat(ton): add jetton master token metadata discovery

Adds a TON token metadata resolver so pasting a jetton master address (`EQ.../UQ...`) auto-fills ticker, decimals, and logo — same UX as EVM/Solana/Tron custom token discovery.

- New `getJettonMasterInfo()` helper hits Toncenter v3 `/jetton/masters`, preferring the validated indexer `token_info` entry over on-chain TEP-64 `jetton_content`.
- Logo selection prefers Toncenter's `imgproxy.toncenter.com` variants (`_image_medium` → `_image_small` → `_image_big`) before the raw `image` URL. Many jetton issuers serve their PNG with `Cross-Origin-Resource-Policy: same-origin`, which browsers refuse to embed cross-origin; the proxied variants load reliably.
- `OtherChain.Ton` added to `chainsWithTokenMetadataDiscovery`; the new `getTonTokenMetadata` resolver is registered under the `ton` chain kind.

Unblocks vultisig/vultisig-windows#4029.
