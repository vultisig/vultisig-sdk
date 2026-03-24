/**
 * Funded E2E helpers: minimal-amount sends, signing/broadcast.
 */

import { Chain, UtxoBasedChain } from '@core/chain/Chain'
import { getChainKind } from '@core/chain/ChainKind'
import type { AccountCoin } from '@core/chain/coin/AccountCoin'
import { signatureAlgorithms } from '@core/chain/signing/SignatureAlgorithm'
import type { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import fs from 'fs/promises'

import { getChainSigningInfo } from '../../../src/adapters/getChainSigningInfo'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { Balance, Signature } from '../../../src/types'
import { VaultBase } from '../../../src/vault/VaultBase'
import { Vultisig } from '../../../src/Vultisig'
import {
  coordinateMultiPartySigning,
  generateSharedSessionParams,
  getThreshold,
  loadVaultShare,
  type VaultShareData,
  verifySharesMatch,
} from '../helpers/secure-vault-helpers'
import { createSigningPayload, TEST_AMOUNTS } from '../helpers/signing-helpers'

export const SCAN_CHAINS = [...new Set(Object.values(Chain))] as Chain[]

const utxoChains = new Set<string>(UtxoBasedChain as unknown as string[])

/**
 * Chains where programmatic multi-party signing matches broadcast expectations today:
 * ECDSA only, and non-UTXO (UTXO multi-hash / secure MPC path is not covered here).
 */
export function supportsCoordinateSecureBroadcast(chain: Chain): boolean {
  if (signatureAlgorithms[getChainKind(chain)] !== 'ecdsa') return false
  if (utxoChains.has(chain)) return false
  return true
}

export const SCAN_CHAINS_SECURE_COORDINATED = SCAN_CHAINS.filter(supportsCoordinateSecureBroadcast)

export const BROADCAST_COOLDOWN_MS = 2000

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createFundedSdk(): Vultisig {
  return new Vultisig({
    storage: new MemoryStorage(),
    serverEndpoints: {
      fastVault: process.env.VULTISIG_API_URL || 'https://api.vultisig.com/vault',
      messageRelay: process.env.VULTISIG_ROUTER_URL || 'https://api.vultisig.com/router',
    },
    defaultChains: SCAN_CHAINS,
    defaultCurrency: 'usd',
  })
}

export async function importFastVault(
  sdk: Vultisig,
  vaultPath: string,
  password: string
): Promise<VaultBase> {
  const content = await fs.readFile(vaultPath, 'utf-8')
  return sdk.importVault(content, password)
}

export async function importSecureVaultFromFirstShare(
  sdk: Vultisig,
  sharePaths: string[],
  password: string
): Promise<VaultBase> {
  const first = sharePaths[0]
  if (!first) {
    throw new Error('No secure vault share paths')
  }
  const content = await fs.readFile(first, 'utf-8')
  return sdk.importVault(content, password)
}

export async function loadSecureShares(sharePaths: string[], password: string): Promise<VaultShareData[]> {
  const shares = await Promise.all(sharePaths.map(p => loadVaultShare(p, password)))
  verifySharesMatch(shares)
  return shares
}

export function parseBalanceKey(key: string): { chain: Chain; tokenId?: string } {
  const colon = key.indexOf(':')
  if (colon === -1) {
    return { chain: key as Chain }
  }
  return {
    chain: key.slice(0, colon) as Chain,
    tokenId: key.slice(colon + 1),
  }
}

export function collectTokenEntries(snapshot: Record<string, Balance>): Array<{ chain: Chain; tokenId: string }> {
  const out: Array<{ chain: Chain; tokenId: string }> = []
  for (const key of Object.keys(snapshot)) {
    if (!key.includes(':')) continue
    const { chain, tokenId } = parseBalanceKey(key)
    if (!tokenId) continue
    const bal = snapshot[key]
    if (!bal || BigInt(bal.amount) <= 0n) continue
    if (!SCAN_CHAINS.includes(chain)) continue
    out.push({ chain, tokenId })
  }
  return out
}

function minimalTokenSendAmount(decimals: number): bigint {
  const exp = Math.max(0, decimals - 3)
  return 10n ** BigInt(exp)
}

export async function resolveTokenSendAmount(params: { balance: Balance }): Promise<bigint | null> {
  const raw = BigInt(params.balance.amount)
  if (raw <= 0n) return null
  const min = minimalTokenSendAmount(params.balance.decimals)
  if (raw < min) return null
  return min
}

export async function resolveNativeSendAmount(params: {
  vault: VaultBase
  chain: Chain
  coin: AccountCoin
}): Promise<bigint | null> {
  const fixed = TEST_AMOUNTS[params.chain]
  if (fixed === undefined) return null
  const bal = await params.vault.balance(params.chain)
  if (BigInt(bal.amount) < fixed) return null
  return fixed
}

export async function signAndBroadcastFast(params: {
  vault: VaultBase
  chain: Chain
  keysignPayload: KeysignPayload
}): Promise<string> {
  const messageHashes = await params.vault.extractMessageHashes(params.keysignPayload)
  const signingPayload = createSigningPayload(params.keysignPayload, messageHashes, params.chain)
  const signature = await params.vault.sign(signingPayload)
  return params.vault.broadcastTx({
    chain: params.chain,
    keysignPayload: params.keysignPayload,
    signature,
  })
}

function relayUrlForMpc(): string {
  return process.env.VULTISIG_ROUTER_URL || 'https://api.vultisig.com/router'
}

export async function signAndBroadcastSecure(params: {
  vault: VaultBase
  shares: VaultShareData[]
  chain: Chain
  keysignPayload: KeysignPayload
}): Promise<string> {
  const messageHashes = await params.vault.extractMessageHashes(params.keysignPayload)
  // Test-only access to wallet core (same pattern as secure-vault-multiparty-signing.test.ts).
  const walletCore = await params.vault['wasmProvider'].getWalletCore()
  const signingInfo = getChainSigningInfo({ chain: params.chain }, walletCore)
  const { sessionId, hexEncryptionKey } = generateSharedSessionParams()
  const threshold = getThreshold(params.shares.length)
  const participatingShares = params.shares.slice(0, threshold)
  const signature: Signature = await coordinateMultiPartySigning(participatingShares, {
    sessionId,
    hexEncryptionKey,
    relayUrl: relayUrlForMpc(),
    messageHashes,
    chainPath: signingInfo.chainPath,
    signatureAlgorithm: signingInfo.signatureAlgorithm,
  })
  return params.vault.broadcastTx({
    chain: params.chain,
    keysignPayload: params.keysignPayload,
    signature,
  })
}
