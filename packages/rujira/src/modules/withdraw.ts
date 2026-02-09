import type { Coin } from '@cosmjs/proto-signing';
import { findAssetByFormat } from '@vultisig/assets';

import type { RujiraClient } from '../client.js';
import { CHAIN_PROCESSING_TIMES } from '../config.js';
import { DEFAULT_THORCHAIN_FEE } from '../config/constants.js';
import { parseAsset as sharedParseAsset } from '../utils/denom-conversion.js';
import { RujiraError, RujiraErrorCode } from '../errors.js';
import { estimateWithdrawFee } from '../services/fee-estimator.js';
import { buildWithdrawalKeysignPayload } from '../signer/keysign-builder.js';
import type { VultisigVault, WithdrawCapableVault } from '../signer/types.js';
import { isWithdrawCapable } from '../signer/types.js';
import { validateL1Address } from '../validation/address-validator.js';
import { buildSecureRedeemMemo } from '../utils/memo.js';
import { thornodeRateLimiter } from '../utils/rate-limiter.js';
import { isFinAsset, parseAsset } from '../utils/type-guards.js';

export interface WithdrawParams {
  asset: string;
  amount: string;
  l1Address: string;
  maxFeeBps?: number;
}

export interface PreparedWithdraw {
  chain: string;
  asset: string;
  denom: string;
  amount: string;
  destination: string;
  memo: string;
  estimatedFee: string;
  estimatedTimeMinutes: number;
  funds: Coin[];
}

export interface WithdrawResult {
  txHash: string;
  asset: string;
  amount: string;
  destination: string;
  status: 'pending' | 'success' | 'failed';
}

function hasVaultAccess(signer: unknown): signer is { getVault(): VultisigVault } {
  return (
    signer !== null &&
    typeof signer === 'object' &&
    'getVault' in signer &&
    typeof (signer as { getVault?: unknown }).getVault === 'function'
  );
}

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

export class RujiraWithdraw {
  private thornodeUrl: string;

  constructor(private readonly client: RujiraClient) {
    this.thornodeUrl = client.config.restEndpoint;
  }

  async prepare(params: WithdrawParams): Promise<PreparedWithdraw> {
    this.validateWithdrawParams(params);

    const { chain } = parseAsset(params.asset);

    const assetData = findAssetByFormat(params.asset);
    if (!isFinAsset(assetData)) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, `Unknown asset: ${params.asset}`);
    }

    const denom = assetData.formats.fin;

    validateL1Address(chain, params.l1Address);

    const memo = this.buildWithdrawMemo(params.l1Address);

    const fee = await this.estimateWithdrawFee(params.asset, params.amount);

    try {
      if (BigInt(params.amount) <= BigInt(fee)) {
        throw new RujiraError(
          RujiraErrorCode.INVALID_AMOUNT,
          `Withdrawal amount (${params.amount}) is too small to cover estimated outbound fee (${fee}) for ${params.asset}. ` +
            'Try a larger amount or wait for lower gas.'
        );
      }
    } catch (error) {
      if (error instanceof RujiraError) throw error;
    }

    const funds: Coin[] = [{ denom, amount: params.amount }];

    return {
      chain,
      asset: params.asset,
      denom,
      amount: params.amount,
      destination: params.l1Address,
      memo,
      estimatedFee: fee,
      estimatedTimeMinutes: this.estimateWithdrawTime(chain),
      funds,
    };
  }

  async execute(prepared: PreparedWithdraw): Promise<WithdrawResult> {
    if (!this.client.canSign()) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'Cannot execute withdrawal without a signer'
      );
    }

    const clientInternal = this.client as unknown as { signer: unknown };
    const signer = clientInternal.signer;

    if (!hasVaultAccess(signer)) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'Withdrawal requires a VultisigRujiraProvider signer with vault access. ' +
          'Standard Cosmos signers are not supported for MsgDeposit operations.'
      );
    }

    try {
      const vault = signer.getVault();

      if (!isWithdrawCapable(vault)) {
        throw new RujiraError(
          RujiraErrorCode.SIGNING_FAILED,
          'Vault does not support withdrawal operations. ' +
            'Required methods: extractMessageHashes, sign, broadcastTx.'
        );
      }

      const senderAddress = await vault.address('THORChain');

      const [accountInfo, fee] = await Promise.all([
        this.getAccountInfo(senderAddress),
        this.getNetworkFee(),
      ]);

      const keysignPayload = await buildWithdrawalKeysignPayload({
        vault,
        senderAddress,
        prepared,
        accountInfo,
        fee,
      });

      const messageHashes = await vault.extractMessageHashes(keysignPayload);

      const signature = await vault.sign({
        transaction: keysignPayload,
        chain: 'THORChain',
        messageHashes,
      });

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
      if (error instanceof RujiraError) {
        throw error;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new RujiraError(
        RujiraErrorCode.CONTRACT_ERROR,
        `Withdrawal execution failed: ${errorMsg}. To withdraw manually, use the Vultisig mobile app with memo: ${prepared.memo}`,
        { originalError: errorMsg, prepared }
      );
    }
  }

  private async getAccountInfo(address: string): Promise<{ accountNumber: string; sequence: string }> {
    try {
      const response = await thornodeRateLimiter.fetch(`${this.thornodeUrl}/auth/accounts/${address}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as AccountInfo;
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

  private async getNetworkFee(): Promise<bigint> {
    try {
      const response = await thornodeRateLimiter.fetch(`${this.thornodeUrl}/thorchain/network`);

      if (response.ok) {
        const data = (await response.json()) as { native_tx_fee_rune?: string };
        if (data.native_tx_fee_rune) {
          return BigInt(data.native_tx_fee_rune);
        }
      }
    } catch {
      // fall back below
    }

    return DEFAULT_THORCHAIN_FEE;
  }

  buildWithdrawMemo(l1Address: string): string {
    return buildSecureRedeemMemo(l1Address);
  }

  estimateWithdrawTime(chain: string): number {
    return CHAIN_PROCESSING_TIMES[chain.toUpperCase()] || 15;
  }

  async estimateWithdrawFee(asset: string, amount: string): Promise<string> {
    return estimateWithdrawFee(this.thornodeUrl, asset, amount);
  }

  async getMinimumWithdraw(asset: string): Promise<string> {
    const { chain } = parseAsset(asset);

    try {
      const response = await thornodeRateLimiter.fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
      if (response.ok) {
        const addresses = (await response.json()) as Array<{ chain: string; dust_threshold: string }>;
        const chainInfo = addresses.find((a) => a.chain === chain);
        if (chainInfo) {
          return chainInfo.dust_threshold;
        }
      }
    } catch {
      // fall back below
    }

    const defaults: Record<string, string> = {
      BTC: '10000',
      ETH: '0',
      BSC: '0',
      AVAX: '0',
      GAIA: '0',
      DOGE: '100000000',
      LTC: '10000',
      BCH: '10000',
    };

    return defaults[chain] || '0';
  }

  async canWithdraw(asset: string): Promise<{ possible: boolean; reason?: string }> {
    const { chain } = parseAsset(asset);

    try {
      const response = await thornodeRateLimiter.fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
      if (!response.ok) {
        return { possible: false, reason: 'Cannot reach THORNode' };
      }

      const addresses = (await response.json()) as Array<{
        chain: string;
        halted: boolean;
        chain_trading_paused: boolean;
        global_trading_paused: boolean;
      }>;
      const chainInfo = addresses.find((a) => a.chain === chain);

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
    } catch {
      return { possible: false, reason: 'Network error checking withdrawal status' };
    }
  }

  private validateWithdrawParams(params: WithdrawParams): void {
    if (!params.asset || !params.asset.includes('.')) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ASSET,
        `Invalid asset format: ${params.asset}. Expected format: CHAIN.SYMBOL`
      );
    }

    if (!params.amount || !/^\d+$/.test(params.amount)) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_AMOUNT,
        'Amount must be a positive integer in base units'
      );
    }

    const amountBigInt = BigInt(params.amount);
    if (amountBigInt <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Amount must be greater than zero');
    }

    if (!params.l1Address || params.l1Address.length === 0) {
      throw new RujiraError(RujiraErrorCode.INVALID_ADDRESS, 'L1 destination address is required');
    }
  }

  private parseAsset(asset: string): { chain: string; symbol: string } {
    const parsed = sharedParseAsset(asset);
    return { chain: parsed.chain, symbol: parsed.symbol };
  }
}
