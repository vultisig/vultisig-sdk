---
'@vultisig/sdk': minor
---

Publish the curated server barrel as a real `@vultisig/sdk/server` subpath. `packages/sdk/src/server/index.ts` has declared itself a public API barrel for the fast-vault and MPC-relay helpers, but no export condition pointed at it and the root entry did not re-export it - so `import '@vultisig/sdk/server'` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` and consumers were pushed to deep imports or local re-wrapping. Adds the export conditions, the runtime bundle, the narrow declaration bundle, and packed-consumer smoke coverage. Note that "server" names the Vultisig fast-vault server these helpers call, not a Node-only runtime, so the subpath ships the same all-platform conditions as `./tx`.
