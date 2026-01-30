/**
 * Withdraw module for withdrawing secured assets to L1 chains
 * 
 * This module provides:
 * - `prepare()`: Build withdrawal parameters (memo, fees, validation)
 * - `execute()`: Execute the withdrawal (currently limited - see note)
 * 
 * **IMPORTANT**: Direct execution of withdrawals via SDK is currently limited.
 * THORChain's MsgDeposit requires Trust Wallet Core for proper encoding,
 * which is not available in the pure JS SDK.
 * 
 * For withdrawals, we recommend:
 * 1. Use `prepare()` to get withdrawal details
 * 2. Execute via Vultisig mobile app or web wallet
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
 * Map THORChain asset chain IDs to Vultisig SDK Chain values
 * THORChain uses short IDs (ETH, BTC), SDK uses full names (Ethereum, Bitcoin)
 */
const THORCHAIN_TO_SDK_CHAIN: Record<string, string> = {
  'ETH': 'Ethereum',
  'BTC': 'Bitcoin',
  'BCH': 'BitcoinCash',
  'DOGE': 'Dogecoin',
  'LTC': 'Litecoin',
  'AVAX': 'Avalanche',
  'BSC': 'BSC',
  'GAIA': 'Cosmos',
  'THOR': 'THORChain',
  'MAYA': 'MayaChain',
  'KUJI': 'Kujira',
  'DASH': 'Dash',
  'ARB': 'Arbitrum',
  'ZEC': 'Zcash',
  'XRP': 'Ripple',
  'BASE': 'Base',
  'TRON': 'Tron',
  'NOBLE': 'Noble',
};

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
 * API returns: { result: { value: { account_number, sequence } } }
 * or sometimes: { account: { account_number, sequence } }
 */
interface AccountInfo {
  result?: {
    value?: {
      account_number?: string;
      sequence?: string;
    };
  };
  account?: {
    account_number?: string;
    sequence?: string;
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
   * Withdrawals are executed by sending a MsgDeposit with the withdrawal memo
   * (-:ASSET:L1_ADDRESS) to THORChain. The SDK builds a keysign payload with
   * isDeposit=true and uses the Vultisig vault's MPC signing flow.
   * 
   * This triggers THORChain's native withdrawal mechanism:
   * - THORChain processes the MsgDeposit
   * - Bifröst nodes execute the L1 outbound transaction
   * - L1 tokens are sent to the destination address
   * 
   * @param prepared - Prepared withdrawal from `prepare()`
   * @returns Withdrawal result with transaction hash
   * @throws {RujiraError} If signer is missing or not a VultisigRujiraProvider
   * 
   * @example
   * ```typescript
   * const prepared = await client.withdraw.prepare({
   *   asset: 'ETH.USDC-0x...',
   *   amount: '1000000',
   *   l1Address: '0x...'
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

    // Get the signer from client (private access via type assertion)
    const clientInternal = this.client as unknown as { signer: unknown };
    const signer = clientInternal.signer;

    // Validate signer has vault access (VultisigRujiraProvider)
    if (!hasVaultAccess(signer)) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'Withdrawal requires a VultisigRujiraProvider signer with vault access. ' +
        'Standard Cosmos signers are not supported for MsgDeposit operations.'
      );
    }

    try {
      // Get the Vultisig vault
      const vault = signer.getVault();
      const senderAddress = await vault.address('THORChain');
      
      // Get account info and fee
      const [accountInfo, fee] = await Promise.all([
        this.getAccountInfo(senderAddress),
        this.getNetworkFee(),
      ]);
      
      // Build the keysign payload with isDeposit=true
      const keysignPayload = await this.buildWithdrawalKeysignPayload({
        vault,
        senderAddress,
        prepared,
        accountInfo,
        fee,
      });
      
      // Extract message hashes for MPC signing (support multiple @vultisig/core versions)
      let messageHashes: string[];
      if (typeof (vault as any).extractMessageHashes === 'function') {
        messageHashes = await (vault as any).extractMessageHashes(keysignPayload);
      } else if ((vault as any).transactionBuilder?.extractMessageHashes) {
        messageHashes = await (vault as any).transactionBuilder.extractMessageHashes(keysignPayload);
      } else {
        throw new RujiraError(
          RujiraErrorCode.SIGNING_FAILED,
          'Vault does not support extractMessageHashes'
        );
      }

      // Sign with MPC (support multiple @vultisig/core versions)
      let signature: unknown;
      if (typeof (vault as any).sign === 'function') {
        signature = await (vault as any).sign({
          transaction: keysignPayload,
          chain: 'THORChain',
          messageHashes,
        });
      } else {
        throw new RujiraError(
          RujiraErrorCode.SIGNING_FAILED,
          'Vault does not support sign()'
        );
      }

      // Broadcast the signed transaction (support multiple @vultisig/core versions)
      let txHash: string;
      if (typeof (vault as any).broadcastTx === 'function') {
        txHash = await (vault as any).broadcastTx({
          chain: 'THORChain',
          keysignPayload,
          signature,
        });
      } else if ((vault as any).broadcastService?.broadcastTx) {
        txHash = await (vault as any).broadcastService.broadcastTx({
          chain: 'THORChain',
          keysignPayload,
          signature,
        });
      } else {
        throw new RujiraError(
          RujiraErrorCode.BROADCAST_FAILED,
          'Vault does not support broadcastTx()'
        );
      }

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
        `To withdraw manually, use the Vultisig mobile app with memo: ${prepared.memo}`,
        { originalError: errorMsg, prepared }
      );
    }
  }

  /**
   * Build a keysign payload for withdrawal (MsgDeposit with isDeposit=true)
   * 
   * KNOWN LIMITATION: The core SDK's signing inputs resolver currently maps
   * all THORChain deposits to the native chain (THOR.X) instead of the L1 
   * chain (ETH.X, BTC.X). This means withdrawals will fail with "insufficient funds"
   * because the asset name is incorrect.
   * 
   * This implementation demonstrates the correct flow and will work once the
   * core SDK is updated to properly handle secured L1 assets in MsgDeposit.
   * 
   * The approach:
   * 1. Use prepareSignDirectTx to get a base payload with derived public key
   * 2. Build the keysign payload with isDeposit=true
   * 3. The SDK handles signing and broadcasting
   */
  private async buildWithdrawalKeysignPayload(params: {
    vault: VultisigVault;
    senderAddress: string;
    prepared: PreparedWithdraw;
    accountInfo: { accountNumber: string; sequence: string };
    fee: bigint;
  }): Promise<KeysignPayload> {
    const { vault, senderAddress, prepared, accountInfo, fee } = params;

    // Parse the asset to get the L1 chain and full symbol (e.g. ETH + USDC-0x...)
    const { chain: thorchainChainId, symbol: fullSymbol } = this.parseAsset(prepared.asset);
    const ticker = fullSymbol.split('-')[0] || fullSymbol;

    // Convert THORChain chain ID (e.g., 'ETH') to SDK Chain value (e.g., 'Ethereum')
    const l1Chain = THORCHAIN_TO_SDK_CHAIN[thorchainChainId] || thorchainChainId;

    // IMPORTANT:
    // For secured asset withdrawals, MsgDeposit must spend a THORChain-native denom
    // (e.g. eth-usdc-0x...) and THORChain enforces that deposited coins are native.
    //
    // We pass the denom as the "asset" via swapPayload.fromCoin so the cosmos resolver
    // builds a THORChainAsset with chain=THOR and symbol=<DENOM>.
    // IMPORTANT: THORChain native denoms are case-sensitive (typically lowercase).
    // Do NOT uppercase the denom, otherwise THORChain will reject the deposit coin
    // as not being native.
    const securedDenomSymbol = prepared.denom;

    const basePayload = await vault.prepareSignDirectTx(
      {
        chain: 'THORChain',
        coin: {
          chain: 'THORChain',
          address: senderAddress,
          decimals: THORCHAIN_DECIMALS,
          ticker: 'RUNE',
        },
        bodyBytes: Buffer.from('dummy').toString('base64'),
        authInfoBytes: Buffer.from('dummy').toString('base64'),
        chainId: 'thorchain-1',
        accountNumber: accountInfo.accountNumber,
        memo: prepared.memo,
      },
      { skipChainSpecificFetch: true }
    );

    const derivedPublicKey = basePayload.coin?.hexPublicKey || vault.publicKeys.ecdsa;

    // Extract contract address from the full symbol (e.g., USDC-0xa0b86991... -> 0xa0b86991...)
    // Use uppercase for THORChain compatibility
    const contractAddress = fullSymbol.includes('-') ? fullSymbol.split('-')[1]?.toUpperCase() : '';

    const keysignPayload: KeysignPayload = {
      // IMPORTANT: coin.chain MUST be THORChain to route to the cosmos resolver
      // The L1 asset info goes in swapPayload.fromCoin instead
      coin: {
        chain: 'THORChain',
        ticker: 'RUNE',
        address: senderAddress,
        contractAddress: '',
        decimals: THORCHAIN_DECIMALS,
        priceProviderId: '',
        isNativeToken: true,
        hexPublicKey: derivedPublicKey,
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
      vaultLocalPartyId: basePayload.vaultLocalPartyId || '', // Use from base payload
      libType: basePayload.libType || 'GG20', // Use from base payload
      
      // Empty arrays for unused fields
      utxoInfo: [],
      
      // Pass L1 asset info via swapPayload.fromCoin for THORChainAsset construction
      // The cosmos resolver uses swapPayload.fromCoin to build the correct THORChainAsset
      // (e.g., chain: 'Ethereum', symbol: 'USDC-0xa0b86991...', ticker: 'USDC')
      swapPayload: {
        case: 'thorchainSwapPayload',
        value: {
          fromAddress: senderAddress,
          // NOTE: this is not a swap. We piggy-back on swapPayload.fromCoin so the
          // cosmos signing resolver constructs the MsgDeposit coin asset correctly.
          // The asset must be THORChain-native for secured asset withdrawals.
          fromCoin: {
            chain: 'THORChain',
            ticker: securedDenomSymbol,
            contractAddress: '',
            decimals: THORCHAIN_DECIMALS,
            address: '',
            priceProviderId: '',
            isNativeToken: true,
            hexPublicKey: '',
            logo: '',
          },
          toCoin: {
            chain: l1Chain,
            ticker: ticker,
            contractAddress: contractAddress,
            decimals: THORCHAIN_DECIMALS,
            address: prepared.destination,
            priceProviderId: '',
            isNativeToken: false,
            hexPublicKey: '',
            logo: '',
          },
          vaultAddress: '',
          routerAddress: '',
          fromAmount: prepared.amount,
          toAmountDecimal: '0',
          toAmountLimit: '0',
          streamingInterval: '0',
          streamingQuantity: '0',
          expirationTime: BigInt(0),
          isAffiliate: false,
          fee: '0',
        },
      },
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
      
      // Handle different API response structures
      // Nine Realms returns: { result: { value: { account_number, sequence } } }
      // Some nodes return: { account: { account_number, sequence } }
      const accountData = data.result?.value || data.account;
      
      if (!accountData) {
        throw new Error('Invalid account response structure');
      }
      
      return {
        accountNumber: accountData.account_number || '0',
        sequence: accountData.sequence || '0',
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
