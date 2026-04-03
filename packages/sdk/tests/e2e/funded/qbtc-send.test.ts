import { Chain } from '@vultisig/core-chain/Chain'
import { beforeAll, describe, expect, it } from 'vitest'

import { VaultBase } from '../../../src/vault/VaultBase'
import { createFundedSdk, importFastVault, signAndBroadcastFast } from './helpers'

function canRun(): boolean {
  return !!process.env.TEST_VAULT_PATH && !!process.env.TEST_VAULT_PASSWORD
}

describe.skipIf(!canRun())('Funded E2E: QBTC Send — Fast vault (MLDSA)', () => {
  let vault: VaultBase
  let qbtcAddress: string

  beforeAll(async () => {
    const sdk = createFundedSdk()
    await sdk.initialize()
    vault = await importFastVault(sdk, process.env.TEST_VAULT_PATH!, process.env.TEST_VAULT_PASSWORD!)
    if (vault.type !== 'fast') {
      throw new Error('TEST_VAULT_PATH must be a fast vault share')
    }
    if (!vault.publicKeyMldsa) {
      throw new Error('Fast vault must have MLDSA keys for QBTC funded E2E')
    }
    qbtcAddress = await vault.address(Chain.QBTC)
    process.stderr.write(`[qbtc fast] address: ${qbtcAddress}\n`)
  }, 120_000)

  it('sends qBTC to self (MLDSA signing + Cosmos REST broadcast)', async ctx => {
    const balance = await vault.balance(Chain.QBTC)
    if (BigInt(balance.amount) === 0n) {
      ctx.skip('no QBTC balance')
      return
    }

    const keysignPayload = await vault.prepareSendTx({
      coin: {
        chain: Chain.QBTC,
        address: qbtcAddress,
        decimals: 8,
        ticker: 'QBTC',
      },
      receiver: qbtcAddress,
      amount: 1000n,
    })

    const txHash = await signAndBroadcastFast({ vault, chain: Chain.QBTC, keysignPayload })
    expect(txHash).toBeTruthy()
    process.stderr.write(`[qbtc fast] tx: ${txHash}\n`)
  }, 120_000)
})
