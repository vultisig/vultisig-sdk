/**
 * WASM + WalletCore init for Node scripts (same pattern as tests/e2e/setup.ts, no Vitest).
 */
import './init-fetch-for-wasm.js'

import { initializeMpcLib } from '@core/mpc/lib/initialize'
import { memoizeAsync } from '@lib/utils/memoizeAsync'
import { initWasm as initWalletCore } from '@trustwallet/wallet-core'

import { configureWasm } from '../../src/context/wasmRuntime'
import { configureCrypto } from '../../src/crypto'
import { NodeCrypto } from '../../src/platforms/node/crypto'

configureCrypto(new NodeCrypto())

let walletCoreInstance: unknown

const initAllWasm = memoizeAsync(async () => {
  const [walletCore] = await Promise.all([initWalletCore(), initializeMpcLib('ecdsa'), initializeMpcLib('eddsa')])
  walletCoreInstance = walletCore
  return walletCore
})

configureWasm(async () => {
  if (walletCoreInstance) return walletCoreInstance
  return initAllWasm()
})
