/**
 * Withdraw module for withdrawing secured assets to L1 chains
 * @module modules/withdraw
 */

import type { RujiraClient } from '../client';
import { RujiraError, RujiraErrorCode } from '../errors';
import { getAsset } from '@vultisig/assets';
import type { Asset } from '@vultisig/assets';
import type { Coin } from '@cosmjs/proto-signing';

/**
 * Type guard to check if an object is a valid Asset with FIN format
 * @internal
 */
function isFinAsset(obj: unknown): obj is Asset & { formats: { fin: string } } {
  if (!obj || typeof obj !== 'object') return false;
  const asset = obj as Partial<Asset>;
  return (
    typeof asset.formats === 'object' &&
    asset.formats !== null &&
    typeof asset.formats.fin === 'string' &&
    asset.formats.fin.length > 0
  );
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Withdrawal parameters
 */
export interface WithdrawParams {
  /** Secured asset to withdraw (e.g., 'BTC.BTC', 'ETH.ETH') */
  asset: string;
  /** Amount in base units */
  amount: string;
  /** L1 destination address */
  l1Address: string;
  /** Optional: maximum acceptable fee in basis points */
  maxFeeBps?: number;
}

/**
 * Prepared withdrawal details
 */
export interface PreparedWithdraw {
  /** Chain being withdrawn to */
  chain: string;
  /** Asset being withdrawn */
  asset: string;
  /** Secured denom being spent */
  denom: string;
  /** Amount to withdraw */
  amount: string;
  /** L1 destination address */
  destination: string;
  /** Memo for the withdrawal transaction */
  memo: string;
  /** Estimated outbound fee */
  estimatedFee: string;
  /** Estimated time to receive on L1 in minutes */
  estimatedTimeMinutes: number;
  /** Funds to send with the transaction */
  funds: Coin[];
}

/**
 * Withdrawal execution result
 */
export interface WithdrawResult {
  /** Transaction hash on THORChain */
  txHash: string;
  /** Asset withdrawn */
  asset: string;
  /** Amount withdrawn */
  amount: string;
  /** Destination L1 address */
  destination: string;
  /** Status */
  status: 'pending' | 'success' | 'failed';
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Estimated L1 confirmation times for withdrawals */
const CHAIN_WITHDRAWAL_TIMES: Record<string, number> = {
  BTC: 30,
  ETH: 5,
  BSC: 2,
  AVAX: 1,
  GAIA: 2,
  DOGE: 20,
  LTC: 15,
  BCH: 20,
  THOR: 0,
};

/** THORChain MsgDeposit type URL */
const MSG_DEPOSIT_TYPE = '/types.MsgDeposit';

// ============================================================================
// MODULE
// ============================================================================

/**
 * Withdraw module for withdrawing secured assets to L1 chains
 * 
 * @example
 * ```typescript
 * const client = new RujiraClient({ network: 'mainnet', signer });
 * await client.connect();
 * 
 * // Prepare a withdrawal
 * const withdraw = await client.withdraw.prepare({
 *   asset: 'BTC.BTC',
 *   amount: '1000000',  // 0.01 BTC
 *   l1Address: 'bc1q...'
 * });
 * 
 * // Execute the withdrawal
 * const result = await client.withdraw.execute(withdraw);
 * console.log(`Withdrawal tx: ${result.txHash}`);
 * ```
 */
export class RujiraWithdraw {
  private thornodeUrl: string;

  constructor(private readonly client: RujiraClient) {
    this.thornodeUrl = client.config.restEndpoint;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Prepare a withdrawal transaction
   * Returns all details needed to execute the withdrawal
   */
  async prepare(params: WithdrawParams): Promise<PreparedWithdraw> {
    // Validate inputs
    this.validateWithdrawParams(params);

    // Parse asset to get chain and validate
    const { chain } = this.parseAsset(params.asset);
    
    // Resolve FIN denom for secured asset
    let denom = params.asset.toLowerCase().replace('.', '-');
    try {
      const assetData = getAsset(params.asset);
      if (isFinAsset(assetData)) {
        denom = assetData.formats.fin;
      }
    } catch {
      // keep fallback
    }

    if (!denom) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${params.asset}`
      );
    }

    // Validate L1 address format
    this.validateL1Address(chain, params.l1Address);

    // Build withdrawal memo
    const memo = this.buildWithdrawMemo(params.asset, params.l1Address);

    // Get estimated fee (would ideally query from THORNode)
    const estimatedFee = await this.estimateWithdrawFee(params.asset, params.amount);

    // Build funds to send
    const funds: Coin[] = [{
      denom,
      amount: params.amount,
    }];

    return {
      chain,
      asset: params.asset,
      denom,
      amount: params.amount,
      destination: params.l1Address,
      memo,
      estimatedFee,
      estimatedTimeMinutes: this.estimateWithdrawTime(chain),
      funds,
    };
  }

  /**
   * Execute a prepared withdrawal
   * 
   * **⚠️ WARNING: This method is not fully implemented yet.**
   * 
   * Currently, this method will throw an error with instructions for manual withdrawal.
   * Native THORChain MsgDeposit integration is pending.
   * 
   * To withdraw manually:
   * 1. Use the `prepare()` method to get withdrawal details
   * 2. Send a THORChain transaction with the memo from `prepared.memo`
   * 3. Include the funds specified in `prepared.funds`
   * 
   * @experimental This method is incomplete and should not be used in production.
   * @param prepared - Prepared withdrawal from `prepare()`
   * @returns Withdrawal result (currently always throws)
   * @throws {RujiraError} Always throws with manual withdrawal instructions
   */
  async execute(prepared: PreparedWithdraw): Promise<WithdrawResult> {
    if (!this.client.canSign()) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'Cannot execute withdrawal without a signer'
      );
    }

    const senderAddress = await this.client.getAddress();

    // Withdrawals are done via THORChain's native withdraw mechanism
    // This sends secured assets to THORChain which then releases L1 assets
    
    // The withdrawal is done by sending a MsgDeposit with the appropriate memo
    // Format: -:ASSET:L1ADDRESS
    
    try {
      // For THORChain native operations, we need to use the stargate client
      // This is a simplified version - in production would use proper THORChain tx types
      const result = await this.client.executeContract(
        '', // No contract - this is a native THORChain operation
        { withdraw: prepared }, // This would be transformed to proper THORChain tx
        prepared.funds,
        prepared.memo
      );

      return {
        txHash: result.transactionHash,
        asset: prepared.asset,
        amount: prepared.amount,
        destination: prepared.destination,
        status: 'pending',
      };
    } catch (error) {
      // For now, provide instructions for manual withdrawal
      throw new RujiraError(
        RujiraErrorCode.CONTRACT_ERROR,
        `Withdrawal execution not yet fully implemented. ` +
        `To withdraw manually, send ${prepared.amount} ${prepared.denom} ` +
        `via THORChain with memo: ${prepared.memo}`,
        { prepared }
      );
    }
  }

  /**
   * Build withdrawal memo
   * Format: -:ASSET:L1_ADDRESS
   */
  buildWithdrawMemo(asset: string, l1Address: string): string {
    return `-:${asset.toUpperCase()}:${l1Address}`;
  }

  /**
   * Estimate withdrawal time in minutes
   */
  estimateWithdrawTime(chain: string): number {
    return CHAIN_WITHDRAWAL_TIMES[chain.toUpperCase()] || 15;
  }

  /**
   * Estimate withdrawal fee
   * Returns estimated fee in the asset's base units
   */
  async estimateWithdrawFee(asset: string, _amount: string): Promise<string> {
    const { chain } = this.parseAsset(asset);
    
    // Try to get actual fee from THORNode inbound_addresses
    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
      if (response.ok) {
        const addresses = await response.json() as Array<{
          chain: string;
          outbound_fee: string;
        }>;
        const chainInfo = addresses.find(a => a.chain === chain);
        if (chainInfo) {
          return chainInfo.outbound_fee;
        }
      }
    } catch {
      // Fall back to defaults
    }

    // Default estimates (in sats/wei/base units)
    const defaultFees: Record<string, string> = {
      BTC: '30000',      // ~0.0003 BTC
      ETH: '2400000000000000', // ~0.0024 ETH
      BSC: '600000000000000',  // ~0.0006 BNB
      AVAX: '24000000000000000', // ~0.024 AVAX
      GAIA: '10000',     // ~0.00001 ATOM
      DOGE: '100000000', // ~1 DOGE
      LTC: '100000',     // ~0.001 LTC
      BCH: '10000',      // ~0.0001 BCH
    };

    return defaultFees[chain] || '0';
  }

  /**
   * Get minimum withdrawal amount for an asset
   */
  async getMinimumWithdraw(asset: string): Promise<string> {
    const { chain } = this.parseAsset(asset);
    
    // Try to get from THORNode
    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
      if (response.ok) {
        const addresses = await response.json() as Array<{
          chain: string;
          dust_threshold: string;
        }>;
        const chainInfo = addresses.find(a => a.chain === chain);
        if (chainInfo) {
          return chainInfo.dust_threshold;
        }
      }
    } catch {
      // Fall back to defaults
    }

    // Default minimum amounts
    const defaults: Record<string, string> = {
      BTC: '10000',       // 0.0001 BTC
      ETH: '0',           // No minimum
      BSC: '0',
      AVAX: '0',
      GAIA: '0',
      DOGE: '100000000',  // 1 DOGE
      LTC: '10000',       // 0.0001 LTC
      BCH: '10000',       // 0.0001 BCH
    };

    return defaults[chain] || '0';
  }

  /**
   * Check if withdrawal is possible for the given asset
   */
  async canWithdraw(asset: string): Promise<{ possible: boolean; reason?: string }> {
    const { chain } = this.parseAsset(asset);

    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
      if (!response.ok) {
        return { possible: false, reason: 'Cannot reach THORNode' };
      }

      const addresses = await response.json() as Array<{
        chain: string;
        halted: boolean;
        chain_trading_paused: boolean;
        global_trading_paused: boolean;
      }>;
      const chainInfo = addresses.find(a => a.chain === chain);

      if (!chainInfo) {
        return { possible: false, reason: `Chain ${chain} not supported` };
      }

      if (chainInfo.halted) {
        return { possible: false, reason: `Chain ${chain} is halted` };
      }

      if (chainInfo.chain_trading_paused || chainInfo.global_trading_paused) {
        return { possible: true, reason: 'Trading paused - withdrawals may be delayed' };
      }

      return { possible: true };
    } catch (error) {
      return { possible: false, reason: 'Network error checking withdrawal status' };
    }
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  private validateWithdrawParams(params: WithdrawParams): void {
    // Validate asset
    if (!params.asset || !params.asset.includes('.')) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Invalid asset format: ${params.asset}. Expected format: CHAIN.SYMBOL`
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

    // Validate L1 address exists
    if (!params.l1Address || params.l1Address.length === 0) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        'L1 destination address is required'
      );
    }
  }

  private validateL1Address(chain: string, address: string): void {
    const validators: Record<string, (addr: string) => boolean> = {
      BTC: (addr) => {
        // Basic BTC address validation
        // Supports: P2PKH (1...), P2SH (3...), Bech32 (bc1...)
        return /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
               /^bc1[a-z0-9]{39,87}$/.test(addr);
      },
      ETH: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      BSC: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      AVAX: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      GAIA: (addr) => /^cosmos1[a-z0-9]{38}$/.test(addr),
      DOGE: (addr) => /^D[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr),
      LTC: (addr) => {
        // Supports: Legacy (L...), P2SH (M..., 3...), Bech32 (ltc1...)
        return /^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
               /^ltc1[a-z0-9]{39,87}$/.test(addr);
      },
      BCH: (addr) => {
        // BCH can use legacy format or CashAddr
        return /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
               /^bitcoincash:[qp][a-z0-9]{41}$/.test(addr) ||
               /^[qp][a-z0-9]{41}$/.test(addr);
      },
    };

    const validator = validators[chain.toUpperCase()];
    if (validator && !validator(address)) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid ${chain} address: ${address}`
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
}
