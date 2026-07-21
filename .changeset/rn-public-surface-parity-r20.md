---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Re-export the SDK's pure parse/tx-normalize/decode helpers from the React Native entrypoint so RN consumers get the same public surface as other first-party platforms.
