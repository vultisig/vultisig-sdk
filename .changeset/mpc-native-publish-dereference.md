---
"@vultisig/mpc-native": patch
---

Fix npm publish failing with HTTP 415 by dereferencing symlinks in `ios/Frameworks` during prepack (registries disallow symlinks in tarballs).
