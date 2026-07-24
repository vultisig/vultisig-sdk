---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `buildKeygenPairingQrPayload` from the root and React Native SDK entrypoints so first-party consumers can build canonical secure-vault pairing QR payloads without deep-importing internal service paths.
