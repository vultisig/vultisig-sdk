/**
 * Deposit module for securing L1 assets on THORChain
 * @module modules/deposit
 */

import type { RujiraClient } from '../client';
import { RujiraError, RujiraErrorCode, wrapError } from '../errors';
import { getAssetInfo, SECURED_ASSETS } from '../config';

// ============================================================================
// TYPES
// ============================================================================

/**
 * THORChain inbound address response
 */
export interface InboundAddress {
  chain: string;
  pub_key: string;
  address: string;
  halted: boolean;
  global_trading_paused: boolean;
  chain_trading_paused: boolean;
  chain_lp_actions_paused: boolean;
  gas_rate: string;
  gas_rate_units: string;
  outbound_tx_size: string;
  outbound_fee: string;
  dust_threshold: string;
}

/**
 * Prepared deposit transaction details
 */
export interface PreparedDeposit {
  /** L1 chain to send from */
  chain: string;
  /** Inbound vault address to send to */
  inboundAddress: string;
  /** Memo to include in the L1 transaction */
  memo: string;
  /** Amount to send (in L1 base units) */
  amount: string;
  /** Asset being deposited */
  asset: string;
  /** Resulting secured denom on THORChain */
  resultingDenom: string;
  /** Estimated confirmation time in minutes */
  estimatedTimeMinutes: number;
  /** Minimum amount (dust threshold) */
  minimumAmount: string;
  /** Recommended gas rate for the L1 transaction */
  gasRate: string;
  /** Gas rate units */
  gasRateUnits: string;
  /** Warning if chain is halted or paused */
  warning?: string;
}

/**
 * Deposit preparation parameters
 */
export interface DepositParams {
  /** L1 asset to deposit (e.g., 'BTC.BTC', 'ETH.ETH') */
  fromAsset: string;
  /** Amount in L1 base units */
  amount: string;
  /** THORChain address to receive secured assets */
  thorAddress: string;
  /** Optional: affiliate address for fee sharing */
  affiliate?: string;
  /** Optional: affiliate fee in basis points */
  affiliateBps?: number;
}

/**
 * Secured balance on THORChain
 */
export interface SecuredBalance {
  /** Secured denom (e.g., 'btc-btc') */
  denom: string;
  /** L1 asset (e.g., 'BTC.BTC') */
  asset: string;
  /** Amount in base units (raw) */
  amount: string;
  /** Human-readable amount (formatted with decimals) */
  formatted: string;
  /** Decimal places (always 8 for THORChain secured assets) */
  decimals: number;
  /** Symbol for display (e.g., 'BTC', 'ETH', 'USDC') */
  symbol: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Supported chains and their estimated confirmation times in minutes */
const CHAIN_CONFIRMATION_TIMES: Record<string, number> = {
  BTC: 30,    // ~3 confirmations
  ETH: 5,     // ~12 confirmations
  BSC: 2,     // Fast finality
  AVAX: 1,    // Sub-second finality
  GAIA: 2,    // Cosmos ~6 seconds
  DOGE: 20,   // ~3 confirmations
  LTC: 15,    // ~3 confirmations
  BCH: 20,    // ~3 confirmations
  THOR: 0,    // Native, instant
};

/** Chain identifiers to their native coin */
const CHAIN_NATIVE_ASSETS: Record<string, string> = {
  BTC: 'BTC.BTC',
  ETH: 'ETH.ETH',
  BSC: 'BSC.BNB',
  AVAX: 'AVAX.AVAX',
  GAIA: 'GAIA.ATOM',
  DOGE: 'DOGE.DOGE',
  LTC: 'LTC.LTC',
  BCH: 'BCH.BCH',
};

// ============================================================================
// MODULE
// ============================================================================

/**
 * Deposit module for securing L1 assets on THORChain
 * 
 * @example
 * ```typescript
 * const client = new RujiraClient({ network: 'mainnet' });
 * 
 * // Prepare a BTC deposit
 * const deposit = await client.deposit.prepare({
 *   fromAsset: 'BTC.BTC',
 *   amount: '1000000',  // 0.01 BTC in sats
 *   thorAddress: 'thor1...'
 * });
 * 
 * // Use the returned details to send an L1 transaction
 * console.log(`Send ${deposit.amount} to ${deposit.inboundAddress}`);
 * console.log(`With memo: ${deposit.memo}`);
 * ```
 */
export class RujiraDeposit {
  private thornodeUrl: string;
  private inboundCache: { data: InboundAddress[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(private readonly client: RujiraClient) {
    this.thornodeUrl = client.config.restEndpoint;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Prepare a deposit transaction
   * Returns all details needed to send an L1 transaction
   */
  async prepare(params: DepositParams): Promise<PreparedDeposit> {
    // Validate inputs
    this.validateDepositParams(params);

    // Parse asset to get chain
    const { chain, symbol } = this.parseAsset(params.fromAsset);

    // Get inbound address for the chain
    const inbound = await this.getInboundAddress(chain);
    if (!inbound) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `No inbound address available for chain: ${chain}`
      );
    }

    // Build the deposit memo
    const memo = this.buildDepositMemo(params.fromAsset, params.thorAddress, params.affiliate, params.affiliateBps);

    // Get asset info for resulting denom
    const assetInfo = getAssetInfo(params.fromAsset);
    const resultingDenom = assetInfo?.denom || params.fromAsset.toLowerCase().replace('.', '-');

    // Build warning if applicable
    let warning: string | undefined;
    if (inbound.halted) {
      warning = `Chain ${chain} is currently halted. Deposits will not be processed.`;
    } else if (inbound.chain_trading_paused) {
      warning = `Trading is paused for ${chain}. Deposits may be delayed.`;
    } else if (inbound.global_trading_paused) {
      warning = 'Global trading is paused. Deposits may be delayed.';
    }

    return {
      chain,
      inboundAddress: inbound.address,
      memo,
      amount: params.amount,
      asset: params.fromAsset,
      resultingDenom,
      estimatedTimeMinutes: this.estimateDepositTime(chain),
      minimumAmount: inbound.dust_threshold,
      gasRate: inbound.gas_rate,
      gasRateUnits: inbound.gas_rate_units,
      warning,
    };
  }

  /**
   * Get secured balances for a THORChain address
   */
  async getBalances(thorAddress: string): Promise<SecuredBalance[]> {
    this.validateThorAddress(thorAddress);

    try {
      const response = await fetch(
        `${this.thornodeUrl}/cosmos/bank/v1beta1/balances/${thorAddress}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { balances: Array<{ denom: string; amount: string }> };
      const balances: SecuredBalance[] = [];

      for (const balance of data.balances || []) {
        // Map denom back to asset
        const asset = this.denomToAsset(balance.denom);
        const assetInfo = asset ? getAssetInfo(asset) : null;
        
        // THORChain secured assets always use 8 decimals for storage
        const decimals = 8;
        const formatted = this.formatAmount(balance.amount, decimals);
        const symbol = this.extractSymbol(asset || balance.denom);
        
        balances.push({
          denom: balance.denom,
          asset: asset || balance.denom,
          amount: balance.amount,
          formatted,
          decimals,
          symbol,
        });
      }

      return balances;
    } catch (error) {
      throw wrapError(error, RujiraErrorCode.NETWORK_ERROR);
    }
  }

  /**
   * Get balance for a specific asset
   */
  async getBalance(thorAddress: string, asset: string): Promise<SecuredBalance | null> {
    const balances = await this.getBalances(thorAddress);
    const assetInfo = getAssetInfo(asset);
    
    if (!assetInfo) {
      return null;
    }

    return balances.find(b => b.denom === assetInfo.denom) || null;
  }

  /**
   * Get inbound address for a specific chain
   */
  async getInboundAddress(chain: string): Promise<InboundAddress | null> {
    const addresses = await this.getInboundAddresses();
    return addresses.find(a => a.chain === chain.toUpperCase()) || null;
  }

  /**
   * Get all inbound addresses
   */
  async getInboundAddresses(): Promise<InboundAddress[]> {
    // Check cache
    if (this.inboundCache && Date.now() - this.inboundCache.timestamp < this.CACHE_TTL_MS) {
      return this.inboundCache.data;
    }

    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as InboundAddress[];
      
      // Cache the result
      this.inboundCache = {
        data,
        timestamp: Date.now(),
      };

      return data;
    } catch (error) {
      throw wrapError(error, RujiraErrorCode.NETWORK_ERROR);
    }
  }

  /**
   * Build deposit memo for L1 transaction
   */
  buildDepositMemo(
    asset: string,
    thorAddress: string,
    affiliate?: string,
    affiliateBps?: number
  ): string {
    // Format: =:CHAIN.ASSET:THORADDR:AFFILIATE:BPS
    // For native chain assets, simplify: =:CHAIN.ASSET:THORADDR
    let memo = `=:${asset.toUpperCase()}:${thorAddress}`;
    
    if (affiliate && affiliateBps !== undefined && affiliateBps > 0) {
      memo += `:${affiliate}:${affiliateBps}`;
    }

    return memo;
  }

  /**
   * Estimate deposit confirmation time in minutes
   */
  estimateDepositTime(chain: string): number {
    return CHAIN_CONFIRMATION_TIMES[chain.toUpperCase()] || 15;
  }

  /**
   * Get supported chains for deposits
   */
  getSupportedChains(): string[] {
    return Object.keys(CHAIN_CONFIRMATION_TIMES);
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chain: string): boolean {
    return chain.toUpperCase() in CHAIN_CONFIRMATION_TIMES;
  }

  /**
   * Check if an asset can be deposited
   */
  canDeposit(asset: string): boolean {
    const { chain } = this.parseAsset(asset);
    return this.isChainSupported(chain);
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  private validateDepositParams(params: DepositParams): void {
    // Validate asset
    if (!params.fromAsset || !params.fromAsset.includes('.')) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Invalid asset format: ${params.fromAsset}. Expected format: CHAIN.SYMBOL`
      );
    }

    const { chain } = this.parseAsset(params.fromAsset);
    if (!this.isChainSupported(chain)) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unsupported chain: ${chain}. Supported: ${this.getSupportedChains().join(', ')}`
      );
    }

    // Validate amount
    if (!params.amount || !/^\d+$/.test(params.amount)) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_AMOUNT,
        'Amount must be a positive integer in base units'
      );
    }

    const amountBigInt = BigInt(params.amount);
    if (amountBigInt <= 0n) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_AMOUNT,
        'Amount must be greater than zero'
      );
    }

    // Validate thor address
    this.validateThorAddress(params.thorAddress);
  }

  private validateThorAddress(address: string): void {
    if (!address) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        'THORChain address is required'
      );
    }

    // Must start with thor1 or sthor1
    if (!address.startsWith('thor1') && !address.startsWith('sthor1')) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid THORChain address: ${address}. Must start with 'thor1' or 'sthor1'`
      );
    }

    // Basic length check
    if (address.length < 40) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid THORChain address length: ${address}`
      );
    }
  }

  private parseAsset(asset: string): { chain: string; symbol: string } {
    const parts = asset.split('.');
    return {
      chain: parts[0]?.toUpperCase() || '',
      symbol: parts.slice(1).join('.') || '',
    };
  }

  private denomToAsset(denom: string): string | null {
    // Look up in known assets
    for (const [asset, info] of Object.entries(SECURED_ASSETS)) {
      if (info.denom === denom) {
        return asset;
      }
    }

    // Try to reverse-engineer: btc-btc -> BTC.BTC
    if (denom.includes('-')) {
      const parts = denom.split('-');
      if (parts.length >= 2) {
        const chain = parts[0]!.toUpperCase();
        const symbol = parts.slice(1).join('-').toUpperCase();
        return `${chain}.${symbol}`;
      }
    }

    return null;
  }

  /**
   * Format raw amount with decimals
   * @param amount Raw amount string
   * @param decimals Number of decimal places
   * @returns Formatted string (e.g., "11.93")
   */
  private formatAmount(amount: string, decimals: number): string {
    const raw = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const whole = raw / divisor;
    const remainder = raw % divisor;
    
    if (remainder === 0n) {
      return whole.toString();
    }
    
    // Pad remainder with leading zeros if needed
    const remainderStr = remainder.toString().padStart(decimals, '0');
    // Trim trailing zeros
    const trimmed = remainderStr.replace(/0+$/, '');
    
    return `${whole}.${trimmed}`;
  }

  /**
   * Extract display symbol from asset or denom
   * @param assetOrDenom Asset string (e.g., "ETH.USDC-0X...") or denom
   * @returns Symbol (e.g., "USDC")
   */
  private extractSymbol(assetOrDenom: string): string {
    // Handle full asset format: ETH.USDC-0X... -> USDC
    if (assetOrDenom.includes('.')) {
      const afterDot = assetOrDenom.split('.')[1] || '';
      // Remove contract address if present
      const symbol = afterDot.split('-')[0] || '';
      return symbol.toUpperCase();
    }
    
    // Handle denom format: eth-usdc-0x... -> USDC
    if (assetOrDenom.includes('-')) {
      const parts = assetOrDenom.split('-');
      if (parts.length >= 2) {
        // Return second part (the symbol), uppercased
        return (parts[1] || '').toUpperCase();
      }
    }
    
    // Handle simple case: rune -> RUNE
    return assetOrDenom.toUpperCase();
  }
}
