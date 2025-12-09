---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

fix: npm package installation issues

- Remove bundled internal packages (@core/*, @lib/*) from SDK dependencies - these are bundled into dist
- Switch CLI build from tsc to esbuild for proper ESM compatibility
- Update publish workflow to use `yarn npm publish` with --tolerate-republish
- Require Node.js >= 20
