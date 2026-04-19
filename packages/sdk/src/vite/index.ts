import type { Plugin } from 'vite'

/**
 * Vite plugin for consumers of `@vultisig/sdk`.
 *
 * Why consumers need this
 * -----------------------
 * The SDK depends on wasm-bindgen glue packages (`@vultisig/lib-dkls`,
 * `@vultisig/lib-schnorr`, `@vultisig/lib-mldsa`) that load their WebAssembly
 * binaries via `new URL('*.wasm', import.meta.url)`. The URL is evaluated
 * relative to wherever the glue module happens to live at runtime.
 *
 * If Vite `optimizeDeps` pre-bundles these packages, the glue ends up in
 * `node_modules/.vite/deps/`, far away from the `.wasm` payloads, and the
 * fetch returns HTML (or 404s). Excluding them from pre-bundling keeps the
 * glue adjacent to its payload inside `node_modules/@vultisig/lib-*`, so
 * the URL resolves correctly in dev, prod builds, and on CI.
 *
 * The plugin returns a partial Vite config from the `config()` hook; Vite
 * concatenates `optimizeDeps.exclude` with the consumer's existing array
 * (documented merge semantics), so this is additive — consumers can keep
 * their own excludes.
 *
 * Usage
 * -----
 * ```ts
 * import vultisig from '@vultisig/sdk/vite'
 * export default defineConfig({
 *   plugins: [vultisig()],
 * })
 * ```
 *
 * SSR
 * ---
 * `optimizeDeps` only applies to the dev pre-bundler. Consumers doing SSR
 * with `ssr.noExternal` that transitively pulls in `@vultisig/lib-*` will
 * need to add those packages to `ssr.external` themselves — it is not set
 * here to avoid clobbering consumer-side SSR config.
 *
 * Options
 * -------
 * None today. Returned as a factory so we can add options without breaking
 * existing imports.
 */

const WASM_GLUE_PACKAGES = [
  '@vultisig/lib-dkls',
  '@vultisig/lib-schnorr',
  '@vultisig/lib-mldsa',
] as const

export default function vultisigSdk(): Plugin {
  return {
    name: 'vultisig-sdk',
    enforce: 'pre',
    config() {
      return {
        optimizeDeps: {
          exclude: [...WASM_GLUE_PACKAGES],
        },
      }
    },
  }
}
