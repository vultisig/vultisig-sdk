---
'@vultisig/sdk': major
---

Install only what the published build imports. `@vultisig/sdk` now has 19 dependencies instead of 57; a fresh `npm install` goes from about 589 MB and 471 packages to about 216 MB and 144.

- The `.d.ts` files inline the `@vultisig/core-chain` and `@vultisig/core-mpc` types, so those packages and their dependency trees (Polkadot, Sui, LI.FI, XRPL, ethers, date-fns) are no longer installed. The Node and browser builds already bundled that code. This also fixes declarations that failed with `skipLibCheck: false`: version-skewed imports of ERC-20 helpers (typed as `any` before), type-only names used as values, and an unresolvable `@trustwallet/wallet-core` deep import.
- Libraries only the React Native build imports are now optional peer dependencies: `@cosmjs/encoding`, `@lifi/sdk`, `@mysten/sui`, `@polkadot/api`, `@polkadot/util`, `@polkadot/util-crypto`, `@solana/spl-token`, `bitcoinjs-lib`, `bs58`, `bs58check`, `cbor-x`, `js-md5`, `ripple-address-codec`, `xrpl`.
- The `@vultisig/sdk/vite` preset's toolchain is now optional peer dependencies (`vite-plugin-wasm`, `vite-plugin-node-polyfills`, `crypto-browserify`, `stream-browserify`, `path-browserify`, `process`, `util`, `events`). The preset resolves them when `vultisig()` runs and throws one error naming any that are missing. `isomorphic-fetch` is also an optional peer, needed only if your app's graph imports `node-fetch`.
- Removed unused dependencies: `axios`, `uuid`, `i18next`, `i18next-http-backend`, `@coral-xyz/anchor`, `date-fns`, `ethers`, `node-fetch`. Added `@cosmjs/proto-signing`, which the build imports but was never declared.

See MIGRATING.md for the install lines React Native and Vite apps need.
