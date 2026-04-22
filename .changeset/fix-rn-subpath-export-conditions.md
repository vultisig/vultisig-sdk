---
'@vultisig/sdk': patch
---

fix(sdk): add `react-native` and `default` conditions to the `./react-native` subpath export

The `./react-native` subpath previously declared only `types` and `import`. Bundlers that
prefer a `react-native` condition (Expo Metro on iOS/Android sets
`unstable_conditionsByPlatform: { android: ['react-native'], ios: ['react-native'] }`)
fall through the `./react-native` subpath when the SDK is resolved through a symlinked
location (e.g. `npm install file:../vultisig-sdk/packages/sdk`,
`pnpm add @vultisig/sdk@link:...`), producing `Unable to resolve "@vultisig/sdk/react-native"`
at bundle time. Published-and-installed SDKs sidestepped the bug because the resolver
cached a direct file path without re-walking conditions through the symlink.

Mirror the conditions already present on the root `.` export so `./react-native` works
identically in both linked and installed modes.
