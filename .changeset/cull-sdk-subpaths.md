---
'@vultisig/sdk': major
---

Remove 19 redundant package subpaths. Their functions and types remain available from the root or corresponding platform entry, with chain, seedphrase, and relay helpers grouped under `chainTron`, `chainUtxo`, `chainTon`, `seedphrase`, and `server`. `@vultisig/sdk/tools/defi` and all platform paths remain published. See `MIGRATING.md` for every path mapping.
