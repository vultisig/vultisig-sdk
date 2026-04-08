/**
 * GHOST Money Market module for lending/borrowing on Rujira
 * @module modules/ghost
 */

import type { Coin } from '@cosmjs/proto-signing'

import type { RujiraClient } from '../client.js'
import { RujiraError, RujiraErrorCode, wrapError } from '../errors.js'
import { isPositiveBigInt } from '../utils/format.js'

// Known vault contract addresses (mainnet)
const GHOST_VAULTS: Record<string, string> = {
  // Major L1 assets
  'btc-btc': 'thor18e6gxcvmqfn06l09gurgwh3urlj9xztqagaslgspl2l74ejuujnqqlzzun',
  'eth-eth': 'thor1xufzny7n3565jy3rvglacengpn6eufw7lk5y9h4zxludkfe96q4s9j5uln',
  'bch-bch': 'thor1km2sgadhmev34v40evf8qh2yw77hxecakn9nu0g35zdtsf905ehqhqk76r',
  'doge-doge': 'thor1drfu6vrn06gam7fdk07xqmavthgy6rnmnmm2mh4fa047qsny52aqvxuck9',
  'ltc-ltc': 'thor1633kq6mxwn24ezdn38xpngksx8wlu458yesdqf3xhs2cfaan96cs2c3gdz',
  'xrp-xrp': 'thor1cvry7e7uzd89dv4hls5rg5m4xykczzu2qvj8dq5e93c75566tk9q7cya3l',
  'gaia-atom': 'thor1wl05yf4keucptp9m69yzenafmn674r9jcwfwdufar75hq9hcmu9sk66g8w',
  'avax-avax': 'thor13etu2zrdqlh69j87dd5dlnfpwa6cuhzlphm7jhj097uvue7mpc5s8y7xal',
  // Stablecoins
  'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':
    'thor1hs6wzyk4tf25ujd7lu07hhnkj4tl38m3wpp6qqw50y5r3e3x7zksnvj3qr',
  'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7':
    'thor1smdzjdm5q5e5kf6farvcgmxe44uhga2ety68veu2nupf5dzx55xsn3u4rj',
  'avax-usdc-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e':
    'thor1hvfg2t2nrjc7svttlq0asehy5hhkvltzjyl7gr3xkredp202hv4synlrle',
  'base-usdc-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913':
    'thor19l9tl8h6nkf5ea4qaxqht6qzgrh5nnh3sng588plke7n72swhn4s5lpyru',
  'bsc-usdt-0x55d398326f99059ff775485246999027b3197955':
    'thor1es23h3sdeytdhntaa88xl3fndj3vahpzm3d0xe8f2vf80d8kygwqlm7zux',
  // THORChain native
  rune: 'thor12xadusl39ad4ru8j333pgylav2lqkgldf0l2etx6wv9u5npzm3as4l5nxx',
  tcy: 'thor197g3d76rp4dsvfy5zz67h5fr3aj8vjmzezmfy9c8z7t9nh63wsms85amlw',
  'x/ruji': 'thor1dqfh48jyjnm60g5xu89vf2q9dm8dv99lcft60php6quljrzc4k9syuugtm',
  // Base chain
  'base-eth': 'thor1yskkyzurah4yxj49udkgacpfj0mkyfmm23al5rmng7nuktd3vpusv8r66h',
  'base-cbbtc-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf':
    'thor1ycnr44val8v9rexn0qa06m920gr4rrrnldkcnf3pah5nr0lkdsxsnxnwsm',
  // Wrapped assets
  'eth-dai-0x6b175474e89094c44da98b954eedeac495271d0f':
    'thor1pkuuapnanzxseywxgp2dmd39p2ysgws2gq9dzs2kw680ed7x58rq03fs9a',
  'eth-wbtc-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599':
    'thor1374grrwf8fndz2glcas7vt6y0fa5vw4lxgh7ay9wm4kc5cjymygsatfs6k',
  'eth-usdp-0x8e870d67f660d95d5be530380d0ec0bd388289e1':
    'thor1jj7nt72ne7mvtsfvp9rze6w4d8pz69cr5s04602gestqpleamweqw8wm6y',
  'eth-gusd-0x056fd409e1d7a124bd7017459dfea2f387b6d5cd':
    'thor1u6razughlrjdu99ku3n803fq0pj5upnut2axj0kxpeaanch9kh7qfprdsn',
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
// Ghost vault code ID for dynamic discovery
const GHOST_VAULT_CODE_ID = 114

export class RujiraGhost {
  private readonly client: RujiraClient
  private discoveredVaults: Record<string, string> | null = null

  constructor(client: RujiraClient) {
    this.client = client
  }

  // --- Vault Discovery ---

  /**
   * List known GHOST lending vaults (hardcoded, instant).
   */
  listVaults(): GhostVaultInfo[] {
    const vaults = this.discoveredVaults ?? GHOST_VAULTS
    return Object.entries(vaults).map(([denom, address]) => ({
      address,
      denom,
      asset: denom
        .split('-')
        .map(s => s.toUpperCase())
        .join('-'),
    }))
  }

  /**
   * Discover vaults dynamically from chain via code_id query.
   * Falls back to hardcoded addresses on failure. Cached per instance.
   */
  async discoverVaults(): Promise<GhostVaultInfo[]> {
    if (this.discoveredVaults) return this.listVaults()

    try {
      const restUrl = this.client.config.restEndpoint
      const resp = await fetch(`${restUrl}/cosmwasm/wasm/v1/code/${GHOST_VAULT_CODE_ID}/contracts?pagination.limit=100`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const data = (await resp.json()) as { contracts?: string[] }
      const contracts = data.contracts ?? []

      if (contracts.length > 0) {
        const vaultMap: Record<string, string> = {}
        for (const addr of contracts) {
          try {
            const config = await this.client.queryContract<{ denom?: string }>(addr, { config: {} })
            if (config.denom) {
              vaultMap[config.denom] = addr
            }
          } catch {
            // Skip broken contracts
          }
        }
        if (Object.keys(vaultMap).length > 0) {
          this.discoveredVaults = vaultMap
        }
      }
    } catch {
      // Fall through to hardcoded
    }

    return this.listVaults()
  }

  /**
   * Get vault contract address for an asset.
   */
  getVaultAddress(denom: string): string | null {
    const vaults = this.discoveredVaults ?? GHOST_VAULTS
    return vaults[denom.toLowerCase()] ?? null
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

    if (!params.amount || !isPositiveBigInt(params.amount)) {
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

    if (!params.receiptAmount || !isPositiveBigInt(params.receiptAmount)) {
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
    if (!params.amount || !isPositiveBigInt(params.amount)) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Borrow amount must be positive')
    }
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
    if (!params.amount || !isPositiveBigInt(params.amount)) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Repay amount must be positive')
    }
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
    const vaults = this.discoveredVaults ?? GHOST_VAULTS
    const address = vaults[denom.toLowerCase()]
    if (!address) {
      const supported = Object.keys(vaults).join(', ')
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown GHOST vault for denom '${denom}'. Supported: ${supported}`
      )
    }
    return address
  }
}
