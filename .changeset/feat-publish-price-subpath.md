---
'@vultisig/sdk': minor
---

Publish the canonical price helpers as a real `@vultisig/sdk/tools/price` subpath. The barrel existed in source but no export condition pointed at it, so `import '@vultisig/sdk/tools/price'` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` and consumers had to take the whole root surface or deep-import into `dist`. Adds the export conditions, the runtime bundle, the narrow declaration bundle, and packed-consumer smoke coverage.
