/**
 * Withdraw module for withdrawing secured assets to L1 chains
 * 
 * Withdrawals are executed via THORChain's native MsgDeposit mechanism.
 * The SDK builds a keysign payload with isDeposit=true and the withdrawal memo,
 * then uses the Vultisig vault to sign and broadcast the transaction.
 * 
 * @module modules/withdraw
 */

import type { RujiraClient } from '../client';
import { RujiraError, RujiraErrorCode } from '../errors';
import { findAssetByFormat } from '@vultisig/assets';
import type { Asset } from '@vultisig/assets';
import type { Coin } from '@cosmjs/proto-signing';
import type { VultisigVault, KeysignPayload } from '../signer/types';

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

/** Default fee for THORChain transactions (0.02 RUNE) */
const DEFAULT_THORCHAIN_FEE = 2000000n;

/** THORChain decimals (always 8) */
const THORCHAIN_DECIMALS = 8;

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if a signer has the getVault method (VultisigRujiraProvider)
 */
function hasVaultAccess(signer: unknown): signer is { getVault(): VultisigVault } {
  return (
    signer !== null &&
    typeof signer === 'object' &&
    'getVault' in signer &&
    typeof (signer as { getVault?: unknown }).getVault === 'function'
  );
}

/**
 * THORChain account info response structure
 */
interface AccountInfo {
  account: {
    account_number: string;
    sequence: string;
  };
}

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
    const assetData = findAssetByFormat(params.asset);
    if (!isFinAsset(assetData)) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Unknown asset: ${params.asset}`
      );
    }

    const denom = assetData.formats.fin;

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
   * Execute a prepared withdrawal via THORChain MsgDeposit
   * 
   * This method builds a keysign payload with isDeposit=true and the withdrawal memo,
   * then uses the Vultisig vault to sign and broadcast the transaction.
   * 
   * The withdrawal triggers THORChain's native withdraw mechanism:
   * - A MsgDeposit with the memo `-:ASSET:L1_ADDRESS` is sent
   * - THORChain processes the withdrawal and sends L1 assets to the destination
   * 
   * @param prepared - Prepared withdrawal from `prepare()`
   * @returns Withdrawal result with transaction hash
   * @throws {RujiraError} If signer is missing or doesn't support vault operations
   * 
   * @example
   * ```typescript
   * const prepared = await client.withdraw.prepare({
   *   asset: 'BTC.BTC',
   *   amount: '1000000',
   *   l1Address: 'bc1q...'
   * });
   * 
   * const result = await client.withdraw.execute(prepared);
   * console.log(`Withdrawal TX: ${result.txHash}`);
   * ```
   */
  async execute(prepared: PreparedWithdraw): Promise<WithdrawResult> {
    if (!this.client.canSign()) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'Cannot execute withdrawal without a signer'
      );
    }

    // Get the signer and check if it's a VultisigRujiraProvider with vault access
    const signer = this.client['signer'];
    
    if (!hasVaultAccess(signer)) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'Withdrawal execution requires a VultisigRujiraProvider signer with vault access. ' +
        'The signer must implement getVault() to support MsgDeposit transactions.'
      );
    }

    const vault = signer.getVault();
    const senderAddress = await this.client.getAddress();

    try {
      // Fetch account info for transaction parameters
      const accountInfo = await this.getAccountInfo(senderAddress);

      // Get network fee from THORNode (or use default)
      const fee = await this.getNetworkFee();

      // Build the keysign payload for the withdrawal
      const keysignPayload = await this.buildWithdrawalKeysignPayload({
        vault,
        senderAddress,
        prepared,
        accountInfo,
        fee,
      });

      // Extract message hashes for signing
      const messageHashes = await vault.extractMessageHashes(keysignPayload);

      // Sign the transaction
      const signature = await vault.sign({
        transaction: keysignPayload,
        chain: 'THORChain',
        messageHashes,
      });

      // Broadcast the transaction
      const txHash = await vault.broadcastTx({
        chain: 'THORChain',
        keysignPayload,
        signature,
      });

      return {
        txHash,
        asset: prepared.asset,
        amount: prepared.amount,
        destination: prepared.destination,
        status: 'pending',
      };
    } catch (error) {
      // Provide helpful error message with manual instructions as fallback
      if (error instanceof RujiraError) {
        throw error;
      }
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new RujiraError(
        RujiraErrorCode.CONTRACT_ERROR,
        `Withdrawal execution failed: ${errorMsg}. ` +
        `To withdraw manually, send ${prepared.amount} ${prepared.denom} ` +
        `via THORChain MsgDeposit with memo: ${prepared.memo}`,
        { originalError: errorMsg, prepared }
      );
    }
  }

  /**
   * Build a keysign payload for withdrawal (MsgDeposit with isDeposit=true)
   * 
   * This constructs the exact payload format expected by the Vultisig SDK
   * for THORChain deposit/withdrawal transactions.
   */
  private async buildWithdrawalKeysignPayload(params: {
    vault: VultisigVault;
    senderAddress: string;
    prepared: PreparedWithdraw;
    accountInfo: { accountNumber: string; sequence: string };
    fee: bigint;
  }): Promise<KeysignPayload> {
    const { vault, senderAddress, prepared, accountInfo, fee } = params;

    // Get the secured asset ticker (e.g., 'BTC' from 'BTC.BTC' or the denom)
    const ticker = this.extractTicker(prepared.asset, prepared.denom);

    // Build the keysign payload structure matching the protobuf schema
    // This is compatible with iOS/Android/Windows signing
    const keysignPayload: KeysignPayload = {
      // Coin info - the secured asset being spent
      coin: {
        chain: 'THORChain',
        ticker: ticker,
        address: senderAddress,
        contractAddress: '', // No contract for native assets
        decimals: THORCHAIN_DECIMALS,
        priceProviderId: '',
        isNativeToken: false, // Secured assets are not native RUNE
        hexPublicKey: vault.publicKeys.ecdsa,
        logo: '',
      },
      
      // For MsgDeposit, toAddress is empty
      toAddress: '',
      
      // Amount in base units (8 decimals)
      toAmount: prepared.amount,
      
      // THORChain-specific parameters with isDeposit=true
      blockchainSpecific: {
        case: 'thorchainSpecific',
        value: {
          accountNumber: BigInt(accountInfo.accountNumber),
          sequence: BigInt(accountInfo.sequence),
          fee: fee,
          isDeposit: true, // CRITICAL: This triggers MsgDeposit encoding
          transactionType: 0, // UNSPECIFIED
        },
      },
      
      // Withdrawal memo: -:ASSET:L1_ADDRESS
      memo: prepared.memo,
      
      // Vault identification
      vaultPublicKeyEcdsa: vault.publicKeys.ecdsa,
      vaultLocalPartyId: '', // Will be filled by vault
      libType: 'GG20', // Default MPC library type
      
      // Empty arrays for unused fields
      utxoInfo: [],
      swapPayload: { case: undefined, value: undefined },
      contractPayload: { case: undefined, value: undefined },
      signData: { case: undefined, value: undefined },
    };

    return keysignPayload;
  }

  /**
   * Get THORChain account info (account number and sequence)
   */
  private async getAccountInfo(address: string): Promise<{ accountNumber: string; sequence: string }> {
    try {
      const response = await fetch(
        `${this.thornodeUrl}/auth/accounts/${address}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as AccountInfo;
      
      return {
        accountNumber: data.account.account_number || '0',
        sequence: data.account.sequence || '0',
      };
    } catch (error) {
      throw new RujiraError(
        RujiraErrorCode.NETWORK_ERROR,
        `Failed to fetch account info for ${address}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the current THORChain network fee
   */
  private async getNetworkFee(): Promise<bigint> {
    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/network`);
      
      if (response.ok) {
        const data = await response.json() as { native_tx_fee_rune?: string };
        if (data.native_tx_fee_rune) {
          return BigInt(data.native_tx_fee_rune);
        }
      }
    } catch {
      // Fall back to default fee
    }
    
    return DEFAULT_THORCHAIN_FEE;
  }

  /**
   * Extract ticker from asset or denom
   * e.g., 'BTC.BTC' -> 'BTC', 'btc/btc' -> 'BTC'
   */
  private extractTicker(asset: string, denom: string): string {
    // Try to extract from asset format (CHAIN.TICKER)
    if (asset.includes('.')) {
      const parts = asset.split('.');
      const tickerPart = parts[1] || '';
      // Handle contract assets like ETH.USDC-0x...
      return tickerPart.split('-')[0].toUpperCase();
    }
    
    // Try to extract from denom format (chain/ticker or chain-ticker)
    const denomParts = denom.split(/[\/\-]/);
    if (denomParts.length >= 2) {
      return (denomParts[1] || '').toUpperCase();
    }
    
    // Fallback to uppercase denom
    return denom.toUpperCase();
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
