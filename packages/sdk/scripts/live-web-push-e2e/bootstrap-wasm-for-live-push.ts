/**
 * WASM + WalletCore init for Node scripts (same pattern as tests/e2e/setup.ts, no Vitest).
 */
import './init-fetch-for-wasm.js'

import { initWasm as initWalletCore } from '@trustwallet/wallet-core'
import { initializeMpcLib } from '@vultisig/core-mpc/lib/initialize'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

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
