import { existsSync, readFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin, PluginOption, ResolvedConfig, UserConfig } from 'vite'

const WASM_GLUE = ['@vultisig/lib-dkls', '@vultisig/lib-schnorr', '@vultisig/lib-mldsa'] as const
const ADDITIONAL_WASM_EXCLUDES = ['7z-wasm'] as const

const sdkPackageJson = fileURLToPath(new URL('../../package.json', import.meta.url))
const requireFromSdk = createRequire(sdkPackageJson)

type ModuleRequire = ReturnType<typeof createRequire>

/** Node builtin → browser shim. The shim packages are optional peers the consumer installs. */
const BROWSER_SHIMS = {
  crypto: 'crypto-browserify',
  stream: 'stream-browserify',
  buffer: 'buffer/',
  util: 'util/',
  path: 'path-browserify',
  events: 'events/',
  process: 'process/browser',
} as const

const DEFAULT_OPT_INCLUDE = ['buffer', 'process', 'crypto-browserify', 'stream-browserify', 'events'] as const

const packageNameOf = (specifier: string) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

/** Resolves from the consumer's project first, then from the SDK's own install. */
const tryResolve = (resolvers: readonly ModuleRequire[], specifier: string) => {
  for (const resolver of resolvers) {
    try {
      return resolver.resolve(specifier)
    } catch {
      // Try the next resolver.
    }
  }
  return undefined
}

/** Absolute paths to ESM shim files (avoids package export edge cases without importing raw CJS files). */
const nodePolyfillShimFiles = (packageDir: string) => ({
  'vite-plugin-node-polyfills/shims/buffer': path.join(packageDir, 'shims/buffer/dist/index.js'),
  'vite-plugin-node-polyfills/shims/process': path.join(packageDir, 'shims/process/dist/index.js'),
  'vite-plugin-node-polyfills/shims/global': path.join(packageDir, 'shims/global/dist/index.js'),
})

/** Resolves every specifier, or throws one error naming each package that is missing. */
const resolvePeers = (resolvers: readonly ModuleRequire[], specifiers: readonly string[]) => {
  const paths: Record<string, string> = {}
  const missing = new Set<string>()
  for (const specifier of specifiers) {
    const resolved = tryResolve(resolvers, specifier)
    if (resolved) paths[specifier] = resolved
    else missing.add(packageNameOf(specifier))
  }
  if (missing.size === 0) return paths
  const names = [...missing].join(' ')
  throw new Error(
    `[vultisig-sdk] @vultisig/sdk/vite needs these packages in your project: ${names}. ` +
      `Install them as dev dependencies: npm install -D ${names} (or yarn add -D / pnpm add -D).`
  )
}

export type VultisigViteOptions = {
  /**
   * Serve `7zz.wasm` from the installed `7z-wasm` package in dev and emit it
   * as a build asset so the SDK's `getSevenZip` helper can load `/7zz.wasm`.
   * @default true
   */
  sevenZipWasm?: boolean
  /**
   * Serve `wallet-core.wasm` from `@trustwallet/wallet-core` in dev and emit it
   * next to Vite chunks during build so the Emscripten loader can fetch it.
   * @default true
   */
  walletCoreWasm?: boolean
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
  /**
   * Define Node's `global` identifier as `globalThis` for browserified dependencies
   * that still reference `global.crypto` during Vite dependency optimization.
   * @default true
   */
  defineGlobal?: boolean
  /**
   * Inject a lightweight `process` global before the app module runs.
   * Some browserified dependencies still read it at module init time.
   * @default true
   */
  browserGlobals?: boolean
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
    walletCoreWasm = true,
    nodePolyfills: useNodePolyfills = false,
    shimResolver: useShimResolver = true,
    aliases: userAliases = {},
    optimizeDeps: userOptimize = {},
    defineGlobal = true,
    browserGlobals = true,
    debug = false,
  } = userOptions

  let configRoot = process.cwd()
  let command: ResolvedConfig['command'] = 'build'
  let sevenZipWasmFile: string | undefined
  let walletCoreWasmFile: string | undefined

  const peerResolvers = [createRequire(path.join(configRoot, 'package.json')), requireFromSdk]
  const peerSpecifiers: string[] = [
    ...Object.values(BROWSER_SHIMS),
    'vite-plugin-wasm',
    ...(useShimResolver || useNodePolyfills ? ['vite-plugin-node-polyfills'] : []),
  ]
  const peerPaths = resolvePeers(peerResolvers, peerSpecifiers)

  const shimAliases = Object.fromEntries(
    Object.entries(BROWSER_SHIMS).flatMap(([builtin, specifier]) => [
      [builtin, peerPaths[specifier]],
      [`node:${builtin}`, peerPaths[specifier]],
    ])
  )
  const mergedAliases: Record<string, string> = {
    ...shimAliases,
    'node-fetch': 'isomorphic-fetch',
    ...userAliases,
  }
  const wasm = requireFromSdk(peerPaths['vite-plugin-wasm']) as () => Plugin
  // `resolve('vite-plugin-node-polyfills')` is `<pkg>/dist/index.cjs`.
  const shimFiles: Readonly<Record<string, string>> = useShimResolver
    ? nodePolyfillShimFiles(path.dirname(path.dirname(peerPaths['vite-plugin-node-polyfills'])))
    : {}
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

  const resolveWalletCoreWasmFile = () => {
    if (walletCoreWasmFile) return walletCoreWasmFile
    const requireFromRoot = createRequire(path.join(configRoot, 'package.json'))
    const resolvers = [requireFromRoot, requireFromSdk]
    for (const resolver of resolvers) {
      try {
        const pkgDir = path.dirname(resolver.resolve('@trustwallet/wallet-core/package.json'))
        const file = path.join(pkgDir, 'dist/lib/wallet-core.wasm')
        if (existsSync(file)) {
          walletCoreWasmFile = file
          return file
        }
      } catch {
        // Try the next resolver; consumers may rely on the SDK's transitive dependency.
      }
    }
    return undefined
  }

  const serveWasmFile = (res: ServerResponse, file: string) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/wasm')
    res.setHeader('Cache-Control', 'no-cache')
    res.end(readFileSync(file))
  }

  const configPlugin: Plugin = {
    name: 'vultisig-sdk:config',
    enforce: 'pre',
    config() {
      return {
        resolve: {
          alias: { ...mergedAliases },
        },
        define: defineGlobal ? { global: 'globalThis', 'process.env': '{}', 'process.env.NODE_DEBUG': '""' } : {},
        optimizeDeps: {
          ...userOptimize,
          include: includeList,
          exclude: excludeList,
        },
      }
    },
  }

  const browserGlobalsPlugin: Plugin = {
    name: 'vultisig-sdk:browser-globals',
    enforce: 'pre',
    transformIndexHtml() {
      if (!browserGlobals) return []
      return [
        {
          tag: 'script',
          children: [
            'globalThis.process ??= {}',
            'globalThis.process.env ??= {}',
            'globalThis.process.browser ??= true',
            'globalThis.process.version ??= ""',
            'globalThis.process.versions ??= {}',
            'globalThis.process.nextTick ??= ((callback, ...args) => queueMicrotask(() => callback(...args)))',
          ].join('\n'),
          injectTo: 'head-prepend',
        },
      ]
    },
  }

  const shimPlugin: Plugin = {
    name: 'vultisig-sdk:polyfill-shim-resolver',
    enforce: 'pre',
    resolveId(id) {
      if (!useShimResolver) return null
      return shimFiles[id] ?? null
    },
  }

  const wasmAssetsPlugin: Plugin = {
    name: 'vultisig-sdk:wasm-assets',
    enforce: 'pre',
    configResolved(c: ResolvedConfig) {
      configRoot = c.root
      command = c.command
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (sevenZipWasm && url === '/7zz.wasm') {
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
          serveWasmFile(res, file)
          return
        }

        if (walletCoreWasm && url.endsWith('/wallet-core.wasm')) {
          const file = resolveWalletCoreWasmFile()
          if (!file) {
            process.stderr.write(
              '[vultisig-sdk] Failed to resolve @trustwallet/wallet-core/dist/lib/wallet-core.wasm for dev server\n'
            )
            res.statusCode = 404
            res.end('wallet-core.wasm not found')
            return
          }

          if (debug) {
            process.stderr.write(`[vultisig-sdk] Serving wallet-core.wasm from ${file}\n`)
          }
          serveWasmFile(res, file)
          return
        }

        next()
        return
      })
    },
    buildStart() {
      if (command !== 'build') return
      if (sevenZipWasm) {
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
      }

      if (!walletCoreWasm) return
      const walletCoreFile = resolveWalletCoreWasmFile()
      if (!walletCoreFile) {
        this.error(
          '[vultisig-sdk] Failed to resolve @trustwallet/wallet-core/dist/lib/wallet-core.wasm. Set `walletCoreWasm: false` only if you host it yourself.'
        )
      }

      this.emitFile({
        type: 'asset',
        fileName: 'assets/wallet-core.wasm',
        source: readFileSync(walletCoreFile),
      })
      if (debug) {
        process.stderr.write(`[vultisig-sdk] Emitted wallet-core.wasm from ${walletCoreFile}\n`)
      }
    },
  }

  const out: Plugin[] = [configPlugin, browserGlobalsPlugin, wasm()]
  if (useShimResolver) out.push(shimPlugin)
  if (useNodePolyfills) {
    const { nodePolyfills: nodePolyfillsFactory } = requireFromSdk(peerPaths['vite-plugin-node-polyfills']) as {
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
  out.push(wasmAssetsPlugin)
  return out
}
