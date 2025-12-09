---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

docs: update documentation to reflect current SDK and CLI interfaces

- Fix import paths: use `@vultisig/sdk` instead of platform-specific paths (`/node`, `/browser`)
- Update Node.js version requirement from 18+ to 20+
- Fix Storage interface documentation (generic types, correct method signatures)
- Fix WASM copy instruction package name (`@vultisig/sdk` not `vultisig-sdk`)
- Add missing CLI environment variable `VULTISIG_VAULT`
- Add missing CLI interactive shell commands (`vault`, `.clear`)
- Add `--vault` global option to CLI documentation
- Fix project structure paths in SDK README
