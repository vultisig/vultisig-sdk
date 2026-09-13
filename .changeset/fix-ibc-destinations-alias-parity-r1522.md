---
'@vultisig/sdk': patch
---

Normalize `fromChain` in `supportedIbcDestinationsFrom()` through the same `normaliseIbcChainId()` alias resolution `prepareIbcTransfer()` already applies. Route keys are built from IBC chain-IDs (`osmosis-1`, `cosmoshub-4`, ...), so calling `supportedIbcDestinationsFrom('Osmosis')` with a canonical Vultisig chain name returned an empty list even though `prepareIbcTransfer({ fromChain: 'Osmosis', ... })` accepted the exact same name — route discovery and route building disagreed on which names work.
