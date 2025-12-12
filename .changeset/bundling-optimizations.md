---
"@vultisig/sdk": patch
---

Optimize SDK bundling configuration

- Add terser minification (~60% bundle size reduction)
- Add clean script to remove stale dist files before builds
- Centralize duplicated onwarn handler in rollup config
- Add package.json exports for react-native and electron platforms
