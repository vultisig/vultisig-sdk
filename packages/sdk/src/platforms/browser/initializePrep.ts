import './preamble'

import { initWasm as initWalletCore } from '@trustwallet/wallet-core'
import initDkls from '@vultisig/lib-dkls/vs_wasm'
import initMldsa from '@vultisig/lib-mldsa/vs_wasm'
import initSchnorr from '@vultisig/lib-schnorr/vs_schnorr_wasm'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { configureMpc, runtimeStore } from '@vultisig/mpc-types'
import { WasmMpcEngine } from '@vultisig/mpc-wasm'

import { configureWasm } from '../../context/wasmRuntime'

// The root and narrow bundles share the process registry, including CJS/ESM.
if (!runtimeStore().mpcEngine) configureMpc(new WasmMpcEngine())

// Process-wide memoized WASM initialization
let walletCoreInstance: any

const initAllWasm = memoizeAsync(async () => {
  // Browser: init() auto-fetches via import.meta.url (like the simple example)
  const [walletCore] = await Promise.all([initWalletCore(), initDkls(), initSchnorr(), initMldsa()])
  walletCoreInstance = walletCore
  return walletCore
})

// Configure WASM on module load
if (!runtimeStore().walletCore)
  configureWasm(async () => {
    if (walletCoreInstance) return walletCoreInstance
    return initAllWasm()
  })
