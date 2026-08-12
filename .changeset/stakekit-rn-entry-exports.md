---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export the new StakeKit helpers from the React Native SDK entrypoint so RN consumers can import the canonical parser, scan builders, and named StakeKit builders without keeping app-local copies.
