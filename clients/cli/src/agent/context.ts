/**
 * Agent Context Builder
 *
 * Builds the wallet context sent with each message to the agent-backend.
 * Includes vault addresses, balances, coins, and address book entries.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'

import type { BalanceInfo, CoinInfo, MessageContext } from './types'

/**
 * Set `context.chain_public_keys` from the vault's per-chain hardened-derived
 * pubkeys, if any. KeyImport/seedphrase vaults carry these for chains whose
 * address can't be derived from the root ECDSA key (Solana, Sui, Polkadot,
 * Terra, …); standard MPC vaults have none.
 *
 * agent-backend reads this off `req.Context.ChainPublicKeys`, persists it on
 * the conversation, and forwards it to MCP tools so derivation uses the
 * hardened path instead of the wrong BIP32 fallback. The field is left unset
 * (not `{}`) when there's nothing to send so `omitempty` semantics hold and
 * the backend's "no chain keys" branch is taken.
 */
function applyChainPublicKeys(vault: VaultBase, context: MessageContext): void {
  const raw = vault.data.chainPublicKeys
  if (!raw) return

  const serialized: Record<string, string> = {}
  for (const chain of Object.keys(raw)) {
    const pubkey = (raw as Record<string, unknown>)[chain]
    if (typeof pubkey === 'string' && pubkey.length > 0) {
      serialized[chain] = pubkey
    }
  }

  if (Object.keys(serialized).length > 0) {
    context.chain_public_keys = serialized
  }
}

/**
 * Build the full message context from vault state.
 * This is sent with each message to give the AI agent full visibility into the wallet.
 */
export async function buildMessageContext(vault: VaultBase): Promise<MessageContext> {
  const context: MessageContext = {
    vault_address: vault.publicKeys.ecdsa,
    vault_name: vault.name,
    mldsa_public_key: vault.publicKeyMldsa,
    ecdsa_public_key: vault.publicKeys.ecdsa,
    eddsa_public_key: vault.publicKeys.eddsa,
    hex_chain_code: vault.hexChainCode,
  }

  applyChainPublicKeys(vault, context)

  // Gather addresses for all active chains
  try {
    const chains = vault.chains
    const addressEntries = await Promise.allSettled(
      chains.map(async chain => ({
        chain: chain.toString(),
        address: await vault.address(chain),
      }))
    )

    const addresses: Record<string, string> = {}
    for (const result of addressEntries) {
      if (result.status === 'fulfilled') {
        addresses[result.value.chain] = result.value.address
      }
    }
    context.addresses = addresses
  } catch {
    // Continue without addresses
  }

  // Gather balances
  try {
    const balanceRecord = await vault.balances()
    const balanceInfos: BalanceInfo[] = []

    for (const [key, balance] of Object.entries(balanceRecord)) {
      balanceInfos.push({
        chain: (balance as any).chainId || key.split(':')[0] || '',
        asset: (balance as any).symbol || '',
        symbol: (balance as any).symbol || '',
        amount: (balance as any).formattedAmount || (balance as any).amount?.toString() || '0',
        decimals: (balance as any).decimals || 18,
      })
    }
    context.balances = balanceInfos
  } catch {
    // Continue without balances
  }

  // Build coins list from active chains
  try {
    const coins: CoinInfo[] = []
    const chains = vault.chains

    for (const chain of chains) {
      // Add native coin
      coins.push({
        chain: chain.toString(),
        ticker: getNativeTokenTicker(chain),
        is_native_token: true,
        decimals: getNativeTokenDecimals(chain),
      })

      // Add custom tokens for this chain
      const tokens = vault.tokens[chain] || []
      for (const token of tokens) {
        coins.push({
          chain: chain.toString(),
          ticker: (token as any).symbol || '',
          contract_address: (token as any).contractAddress || (token as any).id,
          is_native_token: false,
          decimals: (token as any).decimals || 18,
        })
      }
    }
    context.coins = coins
  } catch {
    // Continue without coins
  }

  return context
}

/**
 * Build a minimal context (just addresses, no balances) for faster initial load.
 */
export async function buildMinimalContext(vault: VaultBase): Promise<MessageContext> {
  const context: MessageContext = {
    vault_address: vault.publicKeys.ecdsa,
    vault_name: vault.name,
    ecdsa_public_key: vault.publicKeys.ecdsa,
    eddsa_public_key: vault.publicKeys.eddsa,
    hex_chain_code: vault.hexChainCode,
  }

  applyChainPublicKeys(vault, context)

  try {
    const chains = vault.chains
    const addressEntries = await Promise.allSettled(
      chains.map(async chain => ({
        chain: chain.toString(),
        address: await vault.address(chain),
      }))
    )

    const addresses: Record<string, string> = {}
    for (const result of addressEntries) {
      if (result.status === 'fulfilled') {
        addresses[result.value.chain] = result.value.address
      }
    }
    context.addresses = addresses
  } catch {
    // Continue without addresses
  }

  return context
}

function getNativeTokenTicker(chain: Chain): string {
  const tickers: Partial<Record<Chain, string>> = {
    [Chain.Ethereum]: 'ETH',
    [Chain.Bitcoin]: 'BTC',
    [Chain.Solana]: 'SOL',
    [Chain.THORChain]: 'RUNE',
    [Chain.Cosmos]: 'ATOM',
    [Chain.Avalanche]: 'AVAX',
    [Chain.BSC]: 'BNB',
    [Chain.Polygon]: 'MATIC',
    [Chain.Arbitrum]: 'ETH',
    [Chain.Optimism]: 'ETH',
    [Chain.Base]: 'ETH',
    [Chain.Blast]: 'ETH',
    [Chain.Litecoin]: 'LTC',
    [Chain.Dogecoin]: 'DOGE',
    [Chain.Dash]: 'DASH',
    [Chain.MayaChain]: 'CACAO',
    [Chain.Polkadot]: 'DOT',
    [Chain.Sui]: 'SUI',
    [Chain.Ton]: 'TON',
    [Chain.Tron]: 'TRX',
    [Chain.Ripple]: 'XRP',
    [Chain.Dydx]: 'DYDX',
    [Chain.Osmosis]: 'OSMO',
    [Chain.Terra]: 'LUNA',
    [Chain.Noble]: 'USDC',
    [Chain.Kujira]: 'KUJI',
    [Chain.Zksync]: 'ETH',
    [Chain.CronosChain]: 'CRO',
  }
  return tickers[chain] || chain.toString()
}

function getNativeTokenDecimals(chain: Chain): number {
  const decimals: Partial<Record<Chain, number>> = {
    [Chain.Bitcoin]: 8,
    [Chain.Litecoin]: 8,
    [Chain.Dogecoin]: 8,
    [Chain.Dash]: 8,
    [Chain.Solana]: 9,
    [Chain.Sui]: 9,
    [Chain.Ton]: 9,
    [Chain.Polkadot]: 10,
    [Chain.Cosmos]: 6,
    [Chain.THORChain]: 8,
    [Chain.MayaChain]: 10,
    [Chain.Osmosis]: 6,
    [Chain.Dydx]: 18,
    [Chain.Tron]: 6,
    [Chain.Ripple]: 6,
    [Chain.Noble]: 6,
    [Chain.Kujira]: 6,
    [Chain.Terra]: 6,
  }
  return decimals[chain] || 18
}
