/**
 * Funded E2E: minimal real sends (broadcast) between your fast vault and secure vault.
 *
 * - Fast vault → secure vault addresses (VultiServer cosigning).
 * - Secure vault → fast vault addresses (programmatic multi-party signing).
 *
 * Per-chain tests via `describe.each`; chains with no balance skip. Tokens before native per chain.
 *
 * Secure leg: ECDSA, non-UTXO only (`supportsCoordinateSecureBroadcast`).
 *
 * Requires: TEST_VAULT_PATH, TEST_VAULT_PASSWORD, SECURE_VAULT_SHARES (2+ paths), SECURE_VAULT_PASSWORD.
 */

import { Chain } from '@core/chain/Chain'
import { readFile } from 'fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Balance } from '@/types'
import { VaultBase } from '../../../src/vault/VaultBase'
import type { VaultShareData } from '../helpers/secure-vault-helpers'
import {
  collectTokenEntries,
  createFundedSdk,
  importFastVault,
  importSecureVaultFromFirstShare,
  loadSecureShares,
  SCAN_CHAINS,
  SCAN_CHAINS_SECURE_COORDINATED,
  signAndBroadcastFast,
  signAndBroadcastSecure,
} from './helpers'
import type { SignBroadcastFn } from './sendPipeline'
import { sendTokensThenNativeForChain } from './sendPipeline'

function secureSharePaths(): string[] {
  return (process.env.SECURE_VAULT_SHARES ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function canRunFastSuite(): boolean {
  if (!process.env.TEST_VAULT_PATH || !process.env.TEST_VAULT_PASSWORD) return false
  const shares = secureSharePaths()
  return shares.length >= 2 && !!process.env.SECURE_VAULT_PASSWORD
}

function canRunSecureSuite(): boolean {
  if (!process.env.TEST_VAULT_PATH || !process.env.TEST_VAULT_PASSWORD) return false
  const shares = secureSharePaths()
  return shares.length >= 2 && !!process.env.SECURE_VAULT_PASSWORD
}

describe.skipIf(!canRunFastSuite())('Funded E2E: Send — Fast vault', () => {
  let sourceVault: VaultBase
  let destSecureVault: VaultBase
  let balanceSnapshot: Record<string, Balance> = {}
  let signFast!: SignBroadcastFn

  beforeAll(async () => {
    const np = secureSharePaths()
    const sdkDestSecure = createFundedSdk()
    await sdkDestSecure.initialize()
    destSecureVault = await importSecureVaultFromFirstShare(
      sdkDestSecure,
      np,
      process.env.SECURE_VAULT_PASSWORD!
    )

    const sdkSource = createFundedSdk()
    await sdkSource.initialize()
    sourceVault = await importFastVault(
      sdkSource,
      process.env.TEST_VAULT_PATH!,
      process.env.TEST_VAULT_PASSWORD!
    )
    if (sourceVault.type !== 'fast') {
      throw new Error('TEST_VAULT_PATH must be a fast vault share')
    }

    balanceSnapshot = await sourceVault.balances(SCAN_CHAINS, true)

    signFast = async ({ vault, chain, keysignPayload }) =>
      signAndBroadcastFast({ vault, chain, keysignPayload })
  }, 300_000)

  const receiverForChain = (chain: Chain) => destSecureVault.address(chain)

  describe.each(SCAN_CHAINS)('%s — fast vault', chain => {
    it('sends tokens (if any) then native when balances exist', async ctx => {
      const tokenEntries = collectTokenEntries(balanceSnapshot).filter(t => t.chain === chain)
      const nativeBal = balanceSnapshot[chain]
      const hasNative = nativeBal && BigInt(nativeBal.amount) > 0n
      const hasWork = tokenEntries.length > 0 || hasNative

      if (!hasWork) {
        ctx.skip('no token or native balance on this chain')
      }

      const logs = await sendTokensThenNativeForChain({
        chain,
        sourceVault,
        balanceSnapshot,
        receiverForChain,
        signBroadcast: signFast,
      })

      const hashes = logs.filter(l => l.txHash).map(l => l.txHash as string)
      if (hashes.length === 0) {
        ctx.skip('nothing broadcast (fees, thresholds, or skipped token paths)')
      }
      for (const h of hashes) {
        expect(h).toBeTruthy()
      }
      console.log(`[fast ${chain}] tx: ${hashes.join(', ')}`)
    }, 600_000)
  })
})

describe.skipIf(!canRunSecureSuite())('Funded E2E: Send — Secure vault', () => {
  let sourceVault: VaultBase
  let shares: VaultShareData[] = []
  let destFastVault: VaultBase
  let balanceSnapshot: Record<string, Balance> = {}
  let signSecure!: SignBroadcastFn

  beforeAll(async () => {
    const np = secureSharePaths()
    const pwd = process.env.SECURE_VAULT_PASSWORD!

    const sdkDestFast = createFundedSdk()
    await sdkDestFast.initialize()
    destFastVault = await importFastVault(
      sdkDestFast,
      process.env.TEST_VAULT_PATH!,
      process.env.TEST_VAULT_PASSWORD!
    )

    const sdkSource = createFundedSdk()
    await sdkSource.initialize()
    const firstShare = np[0]
    if (!firstShare) throw new Error('No secure share path')
    const content = await readFile(firstShare, 'utf-8')
    sourceVault = await sdkSource.importVault(content, pwd)
    if (sourceVault.type !== 'secure') {
      throw new Error('Secure send source must be a secure vault')
    }

    shares = await loadSecureShares(np, pwd)
    balanceSnapshot = await sourceVault.balances(SCAN_CHAINS, true)

    signSecure = async ({ vault, chain, keysignPayload }) =>
      signAndBroadcastSecure({ vault, shares, chain, keysignPayload })
  }, 300_000)

  const receiverForChain = (chain: Chain) => destFastVault.address(chain)

  describe.each(SCAN_CHAINS_SECURE_COORDINATED)('%s — secure vault', chain => {
    it('sends tokens (if any) then native when balances exist', async ctx => {
      const tokenEntries = collectTokenEntries(balanceSnapshot).filter(t => t.chain === chain)
      const nativeBal = balanceSnapshot[chain]
      const hasNative = nativeBal && BigInt(nativeBal.amount) > 0n
      const hasWork = tokenEntries.length > 0 || hasNative

      if (!hasWork) {
        ctx.skip('no token or native balance on this chain')
      }

      const logs = await sendTokensThenNativeForChain({
        chain,
        sourceVault,
        balanceSnapshot,
        receiverForChain,
        signBroadcast: signSecure,
      })

      const hashes = logs.filter(l => l.txHash).map(l => l.txHash as string)
      if (hashes.length === 0) {
        ctx.skip('nothing broadcast (fees, thresholds, or skipped token paths)')
      }
      for (const h of hashes) {
        expect(h).toBeTruthy()
      }
      console.log(`[secure ${chain}] tx: ${hashes.join(', ')}`)
    }, 600_000)
  })
})
