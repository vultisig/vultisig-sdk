/**
 * GHOST Money Market module for lending/borrowing on Rujira
 * @module modules/ghost
 */

import type { Coin } from '@cosmjs/proto-signing'

import type { RujiraClient } from '../client.js'
import { RujiraError, RujiraErrorCode, wrapError } from '../errors.js'

// Known vault contract addresses (mainnet)
const GHOST_VAULTS: Record<string, string> = {
  'btc-btc': 'thor18e6gxcvmqfn06l09gurgwh3urlj9xztqagaslgspl2l74ejuujnqqlzzun',
  'eth-eth': 'thor1xufzny7n3565jy3rvglacengpn6eufw7lk5y9h4zxludkfe96q4s9j5uln',
  'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':
    'thor1hs6wzyk4tf25ujd7lu07hhnkj4tl38m3wpp6qqw50y5r3e3x7zksnvj3qr',
  'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7':
    'thor1smdzjdm5q5e5kf6farvcgmxe44uhga2ety68veu2nupf5dzx55xsn3u4rj',
  'bch-bch': 'thor1km2sgadhmev34v40evf8qh2yw77hxecakn9nu0g35zdtsf905ehqhqk76r',
  'doge-doge': 'thor1drfu6vrn06gam7fdk07xqmavthgy6rnmnmm2mh4fa047qsny52aqvxuck9',
  'ltc-ltc': 'thor1633kq6mxwn24ezdn38xpngksx8wlu458yesdqf3xhs2cfaan96cs2c3gdz',
  'xrp-xrp': 'thor1cvry7e7uzd89dv4hls5rg5m4xykczzu2qvj8dq5e93c75566tk9q7cya3l',
}

const GHOST_CREDIT_CONTRACT = 'thor1ekkt8wfls055t7f7yznj07j0s4mtndkq546swutzv2de7sfcxptq27duyt'

// Types

export type GhostVaultInfo = {
  /** Vault contract address */
  address: string
  /** Asset denom (e.g. 'btc-btc') */
  denom: string
  /** Human-readable asset name */
  asset: string
}

export type GhostVaultStatus = {
  /** Vault contract address */
  address: string
  /** Asset denom */
  denom: string
  /** Raw status response from contract */
  status: Record<string, unknown>
}

export type GhostVaultConfig = {
  /** Vault contract address */
  address: string
  /** Raw config response from contract */
  config: Record<string, unknown>
}

export type GhostTransactionParams = {
  contractAddress: string
  executeMsg: object
  funds: Coin[]
}

export type GhostCreditTransactionParams = {
  contractAddress: string
  executeMsg: object
  funds: Coin[]
}

/**
 * GHOST Money Market module.
 *
 * Supports lending (vault deposit/withdraw) and borrowing (credit accounts).
 *
 * @example
 * ```typescript
 * const client = new RujiraClient();
 * await client.connect();
 *
 * // List available vaults
 * const vaults = client.ghost.listVaults();
 *
 * // Query vault status
 * const status = await client.ghost.getVaultStatus('btc-btc');
 *
 * // Build deposit transaction
 * const tx = client.ghost.buildDeposit({ denom: 'btc-btc', amount: '100000' });
 * ```
 */
export class RujiraGhost {
  private readonly client: RujiraClient

  constructor(client: RujiraClient) {
    this.client = client
  }

  // --- Vault Discovery ---

  /**
   * List all known GHOST lending vaults.
   */
  listVaults(): GhostVaultInfo[] {
    return Object.entries(GHOST_VAULTS).map(([denom, address]) => ({
      address,
      denom,
      asset: denom
        .split('-')
        .map(s => s.toUpperCase())
        .join('-'),
    }))
  }

  /**
   * Get vault contract address for an asset.
   */
  getVaultAddress(denom: string): string | null {
    return GHOST_VAULTS[denom.toLowerCase()] ?? null
  }

  // --- Vault Queries ---

  /**
   * Query vault status (utilization, rates, pool sizes).
   */
  async getVaultStatus(denom: string): Promise<GhostVaultStatus> {
    const address = this.resolveVault(denom)

    try {
      const status = await this.client.queryContract<Record<string, unknown>>(address, { status: {} })
      return { address, denom, status }
    } catch (error) {
      throw wrapError(error)
    }
  }

  /**
   * Query vault configuration (interest rate params, underlying denom).
   */
  async getVaultConfig(denom: string): Promise<GhostVaultConfig> {
    const address = this.resolveVault(denom)

    try {
      const config = await this.client.queryContract<Record<string, unknown>>(address, { config: {} })
      return { address, config }
    } catch (error) {
      throw wrapError(error)
    }
  }

  // --- Vault Lending Operations ---

  /**
   * Build deposit (lend) transaction params.
   * Deposits assets into a GHOST vault to earn yield.
   * Returns receipt tokens representing your share.
   */
  buildDeposit(params: { denom: string; amount: string }): GhostTransactionParams {
    const address = this.resolveVault(params.denom)

    if (!params.amount || BigInt(params.amount) <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Deposit amount must be positive')
    }

    return {
      contractAddress: address,
      executeMsg: { deposit: {} },
      funds: [{ denom: params.denom.toLowerCase(), amount: params.amount }],
    }
  }

  /**
   * Build withdraw (unlend) transaction params.
   * Withdraws assets from a GHOST vault by returning receipt tokens.
   */
  buildWithdraw(params: { denom: string; receiptAmount: string }): GhostTransactionParams {
    const address = this.resolveVault(params.denom)

    if (!params.receiptAmount || BigInt(params.receiptAmount) <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Withdraw amount must be positive')
    }

    // Receipt token denom is typically the vault-specific token
    // The user sends receipt tokens as funds
    return {
      contractAddress: address,
      executeMsg: { withdraw: {} },
      funds: [{ denom: `x/ghost-vault/${params.denom.toLowerCase()}`, amount: params.receiptAmount }],
    }
  }

  // --- Credit Account Operations ---

  /**
   * Build create credit account transaction.
   */
  buildCreateCreditAccount(params: { salt: string; label: string; tag?: string }): GhostCreditTransactionParams {
    return {
      contractAddress: GHOST_CREDIT_CONTRACT,
      executeMsg: {
        create: {
          salt: params.salt,
          label: params.label,
          tag: params.tag ?? null,
        },
      },
      funds: [],
    }
  }

  /**
   * Build borrow transaction via credit account dispatch.
   */
  buildBorrow(params: { creditAccount: string; denom: string; amount: string }): GhostCreditTransactionParams {
    return {
      contractAddress: GHOST_CREDIT_CONTRACT,
      executeMsg: {
        account: {
          addr: params.creditAccount,
          msgs: [{ borrow: { denom: params.denom, amount: params.amount } }],
        },
      },
      funds: [],
    }
  }

  /**
   * Build repay transaction via credit account dispatch.
   */
  buildRepay(params: { creditAccount: string; denom: string; amount: string }): GhostCreditTransactionParams {
    return {
      contractAddress: GHOST_CREDIT_CONTRACT,
      executeMsg: {
        account: {
          addr: params.creditAccount,
          msgs: [{ repay: { denom: params.denom, amount: params.amount } }],
        },
      },
      funds: [{ denom: params.denom, amount: params.amount }],
    }
  }

  /**
   * Build close credit position transaction.
   */
  buildClosePosition(params: { creditAccount: string }): GhostCreditTransactionParams {
    return {
      contractAddress: GHOST_CREDIT_CONTRACT,
      executeMsg: {
        account: {
          addr: params.creditAccount,
          msgs: [{ close: {} }],
        },
      },
      funds: [],
    }
  }

  /**
   * Query credit accounts for an owner.
   */
  async getCreditAccounts(owner: string): Promise<Record<string, unknown>> {
    try {
      return await this.client.queryContract<Record<string, unknown>>(GHOST_CREDIT_CONTRACT, {
        accounts: { owner },
      })
    } catch (error) {
      throw wrapError(error)
    }
  }

  /**
   * Query a specific credit account.
   */
  async getCreditAccount(creditAccount: string): Promise<Record<string, unknown>> {
    try {
      return await this.client.queryContract<Record<string, unknown>>(GHOST_CREDIT_CONTRACT, {
        account: creditAccount,
      })
    } catch (error) {
      throw wrapError(error)
    }
  }

  /** Ghost Credit contract address */
  get creditContract(): string {
    return GHOST_CREDIT_CONTRACT
  }

  // --- Internal ---

  private resolveVault(denom: string): string {
    const address = GHOST_VAULTS[denom.toLowerCase()]
    if (!address) {
      const supported = Object.keys(GHOST_VAULTS).join(', ')
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown GHOST vault for denom '${denom}'. Supported: ${supported}`
      )
    }
    return address
  }
}
