---
'@vultisig/sdk': minor
---

Publish four barrels that existed in source but were unreachable from an installed package: `@vultisig/sdk/tools/dex`, `/tools/evm`, `/tools/cosmos` and `/signable-transaction`. Each had a barrel and, in several cases, a root re-export, but no export condition and no bundle, so importing the documented-looking subpath failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` and consumers had to take the whole root surface or deep-import into `dist`. Adds export conditions, runtime bundles, declaration bundles, and packed-consumer smoke coverage for all four.
