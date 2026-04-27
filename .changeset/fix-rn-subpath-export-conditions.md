---
'@vultisig/sdk': minor
---

feat(sdk/rn): make React Native consumption ergonomic

Two changes land together because both address making the RN build correctly consumable without the consumer having to hand-roll workarounds.

1. **`./react-native` subpath export conditions**

The `./react-native` subpath previously declared only `types` and `import`. Bundlers that prefer a `react-native` condition (Expo Metro on iOS/Android sets `unstable_conditionsByPlatform: { android: ['react-native'], ios: ['react-native'] }`) fall through the `./react-native` subpath when the SDK is resolved through a symlinked location (e.g. `npm install file:../vultisig-sdk/packages/sdk`, `pnpm add @vultisig/sdk@link:...`), producing `Unable to resolve "@vultisig/sdk/react-native"` at bundle time. Published-and-installed SDKs sidestepped the bug because the resolver cached a direct file path without re-walking conditions through the symlink. Mirror the conditions already present on the root `.` export so `./react-native` works identically in both linked and installed modes.

2. **New `./rn-preamble` side-effect subpath**

Adds `@vultisig/sdk/rn-preamble` — a tiny side-effect module consumers import as the **first statement** in their RN app entry to install `globalThis.Buffer` and repair `Buffer.prototype.subarray` (RN's polyfill returns a plain `Uint8Array`, which breaks `.copy()` on downstream consumers like `@ton/core`). Previously consumers had to hand-write these polyfills, and getting the import order wrong crashed Hermes at boot with `Property 'Buffer' doesn't exist` — before the SDK's own RN entry could install its polyfill, because Metro hoists `require()` calls and transitive chain-lib module bodies evaluate before the SDK entry's statements run. The preamble is designed specifically to be the first `require` Metro hoists, so its body completes before anything else imports.

Consumer usage:

```ts
// index.ts (RN app entry — must be the first line)
import '@vultisig/sdk/rn-preamble'

// ...all other imports follow
```

Additive: no existing export or subpath is changed; consumers who don't use the preamble are unaffected.
