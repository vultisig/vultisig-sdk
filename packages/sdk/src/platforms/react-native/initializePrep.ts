// Buffer polyfill MUST happen before any SDK module graph import. Several
// bundled deps read `globalThis.Buffer` at module-init (e.g. @solana/web3.js,
// @noble/*, @polkadot/*). Consumers often polyfill Buffer in App.tsx, but
// because ES module imports are hoisted, the SDK's module bodies can evaluate
// before App.tsx's polyfill runs. Polyfilling here guarantees ordering.
import { Buffer as _Buffer } from 'buffer'

if (typeof globalThis !== 'undefined' && !(globalThis as { Buffer?: unknown }).Buffer) {
  ;(globalThis as { Buffer?: unknown }).Buffer = _Buffer
}

// Hermes polyfills — RN-only. These run for side effects at module load so
// that any chain-lib module body that evaluates `new Intl.PluralRules(...)`
// or `class X extends Event` can resolve those globals without crashing.
//
// - @mysten/sui/dist/client/utils.mjs evaluates `new Intl.PluralRules(...)`
//   at module top-level. Hermes ships without Intl.PluralRules.
// - @lifi/sdk's transitive `@wallet-standard/app` declares
//   `class AppReadyEvent extends Event` at module top-level. Hermes ships
//   without the `Event`/`EventTarget` DOM globals.
//
// Intl.PluralRules' own ResolveLocale reaches into Intl.Locale, and the
// ordinal PluralRules constructor used by @mysten/sui also reaches into
// Intl.NumberFormat — all four sub-APIs are absent on Hermes. Install the
// full cascade in dependency order: getCanonicalLocales → Locale →
// NumberFormat → PluralRules.
//
// Without these, even lazy `import('@mysten/sui/graphql')` /
// `import('@lifi/sdk')` crashes the first time the module is evaluated.
import '@formatjs/intl-getcanonicallocales/polyfill.js'
import '@formatjs/intl-locale/polyfill.js'
import '@formatjs/intl-numberformat/polyfill.js'
import '@formatjs/intl-numberformat/locale-data/en.js'
import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import 'event-target-polyfill'

import { runtimeStore } from '@vultisig/mpc-types'
import { NativeWalletCore } from '@vultisig/walletcore-native'

import { configureWasm } from '../../context/wasmRuntime'

if (!runtimeStore().walletCore) {
  configureWasm(async () => NativeWalletCore.getInstance())
}
