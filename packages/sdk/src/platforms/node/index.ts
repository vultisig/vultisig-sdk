/**
 * Node.js platform entry point
 *
 * This bundle includes only Node.js-specific implementations:
 * - FileStorage (filesystem)
 * - NodeCrypto (native crypto)
 * - NodePolyfills (minimal)
 *
 * All browser code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, FileStorage } from '@vultisig/sdk/node'
 *
 * const sdk = new Vultisig({
 *   storage: new FileStorage({ basePath: '~/.myapp' })
 * })
 * await sdk.initialize()
 * ```
 */

import initDkls from '@lib/dkls/vs_wasm'
import initSchnorr from '@lib/schnorr/vs_schnorr_wasm'
import { initWasm as initWalletCore } from '@trustwallet/wallet-core'
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { configureWasm } from '../../context/wasmRuntime'
import { configureCrypto } from '../../crypto'
import { memoizeAsync } from '../../utils/memoizeAsync'
import { NodeCrypto } from './crypto'
import { NodePolyfills } from './polyfills'
import { FileStorage } from './storage'

const currentDir = dirname(fileURLToPath(import.meta.url))

// Configure crypto
configureCrypto(new NodeCrypto())

// Process-wide memoized WASM initialization
let walletCoreInstance: any

const initAllWasm = memoizeAsync(async () => {
  // Node: read WASM from filesystem (like the simple example)
  const libDir = join(currentDir, '../../lib')

  const [dklsBytes, schnorrBytes] = await Promise.all([
    readFile(join(libDir, 'dkls/vs_wasm_bg.wasm')),
    readFile(join(libDir, 'schnorr/vs_schnorr_wasm_bg.wasm')),
  ])

  const [walletCore] = await Promise.all([initWalletCore(), initDkls(dklsBytes), initSchnorr(schnorrBytes)])

  walletCoreInstance = walletCore
  return walletCore
})

// Configure WASM on module load
configureWasm(async () => {
  if (walletCoreInstance) return walletCoreInstance
  return initAllWasm()
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { FileStorage, NodeCrypto, NodePolyfills }

// Backwards-compatible alias
export { FileStorage as NodeStorage }
