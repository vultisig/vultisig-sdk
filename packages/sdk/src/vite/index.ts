import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin, PluginOption, ResolvedConfig, UserConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

const WASM_GLUE = ['@vultisig/lib-dkls', '@vultisig/lib-schnorr', '@vultisig/lib-mldsa'] as const
const ADDITIONAL_WASM_EXCLUDES = ['7z-wasm'] as const

const DEFAULT_ALIASES: Readonly<Record<string, string>> = {
  crypto: 'crypto-browserify',
  stream: 'stream-browserify',
  buffer: 'buffer',
  util: 'util',
  path: 'path-browserify',
  events: 'events',
  'node-fetch': 'isomorphic-fetch',
}

const DEFAULT_OPT_INCLUDE = ['buffer', 'process', 'crypto-browserify', 'stream-browserify', 'events'] as const

const sdkPackageJson = fileURLToPath(new URL('../../package.json', import.meta.url))
const requireFromSdk = createRequire(sdkPackageJson)

const nodePolyfillsPackageDir = path.dirname(path.dirname(requireFromSdk.resolve('vite-plugin-node-polyfills')))

/** Absolute paths to ESM shim files (avoids package export edge cases without importing raw CJS files). */
const BUFFER_SHIM_FILE = path.join(nodePolyfillsPackageDir, 'shims/buffer/dist/index.js')
const PROCESS_SHIM_FILE = path.join(nodePolyfillsPackageDir, 'shims/process/dist/index.js')
const GLOBAL_SHIM_FILE = path.join(nodePolyfillsPackageDir, 'shims/global/dist/index.js')

export type VultisigViteOptions = {
  /**
   * Serve `7zz.wasm` from the installed `7z-wasm` package in dev and emit it
   * as a build asset so the SDK's `getSevenZip` helper can load `/7zz.wasm`.
   * @default true
   */
  sevenZipWasm?: boolean
  /**
   * Apply `vite-plugin-node-polyfills` with the settings the SDK browser build expects.
   *
   * **Vite 8 (Rolldown):** keep `false` (default) — the polyfill package’s Rolldown/alias
   * integration is currently incompatible (alias resolution errors in some setups).
   * The preset still adds resolve aliases, shim resolution, and `optimizeDeps` tuning.
   *
   * **Vite 5/6/7:** set to `true` if you need the full `node-stdlib-browser` map from
   * that plugin.
   *
   * @default false
   */
  nodePolyfills?: boolean
  /**
   * Resolve `vite-plugin-node-polyfills/shims/*` the same way the hand-written example did
   * (avoids package export edge cases in some toolchains).
   * @default true
   */
  shimResolver?: boolean
  /** Merged on top of the default browser aliases (SDK Node-ish imports). */
  aliases?: Record<string, string>
  /** Shallow-merged with plugin defaults; use to extend `include` / `exclude` / `rolldownOptions` (Vite 8+). */
  optimizeDeps?: UserConfig['optimizeDeps']
  /** Log one line when 7z wasm is served/emitted; resolution failures are always printed. @default false */
  debug?: boolean
}

/**
 * Vite plugin preset for consumers of `@vultisig/sdk` in the browser.
 *
 * Composes: wasm plugin, optional `vite-plugin-node-polyfills`, shim resolution, `optimizeDeps` tuning,
 * and (by default) serving/emitting `7zz.wasm` so `@vultisig/core-mpc`'s 7z loader
 * can fetch `/7zz.wasm` without writing into the consumer's `public` folder.
 *
 * WASM bindgen packages (`@vultisig/lib-dkls`, `lib-schnorr`, `lib-mldsa`) are excluded
 * from pre-bundling so glue and `.wasm` files stay in `node_modules` (see `README`).
 *
 * **Usage:** add one entry; Vite flattens the nested plugin list.
 * ```ts
 * import { defineConfig } from 'vite'
 * import react from '@vitejs/plugin-react'
 * import vultisig from '@vultisig/sdk/vite'
 *
 * export default defineConfig({
 *   plugins: [react(), vultisig()],
 * })
 * ```
 */
export default function vultisig(userOptions: VultisigViteOptions = {}): PluginOption {
  const {
    sevenZipWasm = true,
    nodePolyfills: useNodePolyfills = false,
    shimResolver: useShimResolver = true,
    aliases: userAliases = {},
    optimizeDeps: userOptimize = {},
    debug = false,
  } = userOptions

  let configRoot = process.cwd()
  let sevenZipWasmFile: string | undefined
  const mergedAliases: Record<string, string> = { ...DEFAULT_ALIASES, ...userAliases }
  const excludeList = [...WASM_GLUE, ...ADDITIONAL_WASM_EXCLUDES, ...(userOptimize.exclude ?? [])]
  const includeList = [...DEFAULT_OPT_INCLUDE, ...(userOptimize.include ?? [])]

  const resolveSevenZipWasmFile = () => {
    if (sevenZipWasmFile) return sevenZipWasmFile
    const requireFromRoot = createRequire(path.join(configRoot, 'package.json'))
    const resolvers = [requireFromRoot, requireFromSdk]
    for (const resolver of resolvers) {
      try {
        const pkgDir = path.dirname(resolver.resolve('7z-wasm/package.json'))
        const file = path.join(pkgDir, '7zz.wasm')
        if (existsSync(file)) {
          sevenZipWasmFile = file
          return file
        }
      } catch {
        // Try the next resolver; consumers may rely on the SDK's transitive dependency.
      }
    }
    return undefined
  }

  const configPlugin: Plugin = {
    name: 'vultisig-sdk:config',
    enforce: 'pre',
    config() {
      return {
        resolve: {
          alias: { ...mergedAliases },
        },
        optimizeDeps: {
          ...userOptimize,
          include: includeList,
          exclude: excludeList,
        },
      }
    },
  }

  const shimPlugin: Plugin = {
    name: 'vultisig-sdk:polyfill-shim-resolver',
    enforce: 'pre',
    resolveId(id) {
      if (!useShimResolver) return null
      if (id === 'vite-plugin-node-polyfills/shims/buffer') {
        return BUFFER_SHIM_FILE
      }
      if (id === 'vite-plugin-node-polyfills/shims/process') {
        return PROCESS_SHIM_FILE
      }
      if (id === 'vite-plugin-node-polyfills/shims/global') {
        return GLOBAL_SHIM_FILE
      }
      return null
    },
  }

  const sevenZipPlugin: Plugin = {
    name: 'vultisig-sdk:7z-wasm',
    enforce: 'pre',
    configResolved(c: ResolvedConfig) {
      configRoot = c.root
    },
    configureServer(server) {
      if (!sevenZipWasm) return
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/7zz.wasm') {
          next()
          return
        }

        const file = resolveSevenZipWasmFile()
        if (!file) {
          process.stderr.write('[vultisig-sdk] Failed to resolve 7z-wasm/7zz.wasm for dev server\n')
          res.statusCode = 404
          res.end('7zz.wasm not found')
          return
        }

        if (debug) {
          process.stderr.write(`[vultisig-sdk] Serving 7zz.wasm from ${file}\n`)
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/wasm')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(file))
      })
    },
    buildStart() {
      if (!sevenZipWasm) return
      const file = resolveSevenZipWasmFile()
      if (!file) {
        this.error(
          '[vultisig-sdk] Failed to resolve 7z-wasm/7zz.wasm. Set `sevenZipWasm: false` only if you host `/7zz.wasm` yourself.'
        )
      }

      this.emitFile({
        type: 'asset',
        fileName: '7zz.wasm',
        source: readFileSync(file),
      })
      if (debug) {
        process.stderr.write(`[vultisig-sdk] Emitted 7zz.wasm from ${file}\n`)
      }
    },
  }

  const out: Plugin[] = [configPlugin, wasm() as unknown as Plugin]
  if (useShimResolver) out.push(shimPlugin)
  if (useNodePolyfills) {
    const { nodePolyfills: nodePolyfillsFactory } = requireFromSdk('vite-plugin-node-polyfills') as {
      nodePolyfills: (opts: Record<string, unknown>) => Plugin
    }
    out.push(
      nodePolyfillsFactory({
        exclude: ['fs'],
        globals: { Buffer: true, global: true, process: true },
        protocolImports: true,
      }) as Plugin
    )
  }
  out.push(sevenZipPlugin)
  return out
}
