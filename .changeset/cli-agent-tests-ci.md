---
"@vultisig/cli": patch
"@vultisig/sdk": patch
---

Add Vitest for the CLI package and run CLI tests from the root `yarn test` script. Unimplemented agent actions now return `success: false` with an error message instead of `success: true` with a `data.message` field.
