import type { Coin } from '@cosmjs/proto-signing';
import { findAssetByFormat } from '@vultisig/assets';
import type { Asset } from '@vultisig/assets';

import type { RujiraClient } from '../client.js';
import { RujiraError, RujiraErrorCode } from '../errors.js';
import type { KeysignPayload, VultisigVault } from '../signer/types.js';

const THORCHAIN_TO_SDK_CHAIN: Record<string, string> = {
  ETH: 'Ethereum',
  BTC: 'Bitcoin',
  BCH: 'BitcoinCash',
  DOGE: 'Dogecoin',
  LTC: 'Litecoin',
  AVAX: 'Avalanche',
  BSC: 'BSC',
  GAIA: 'Cosmos',
  THOR: 'THORChain',
  MAYA: 'MayaChain',
  KUJI: 'Kujira',
  DASH: 'Dash',
  ARB: 'Arbitrum',
  ZEC: 'Zcash',
  XRP: 'Ripple',
  BASE: 'Base',
  TRON: 'Tron',
  NOBLE: 'Noble',
};

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

const DEFAULT_THORCHAIN_FEE = 2000000n;
const THORCHAIN_DECIMALS = 8;

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

    const { chain } = this.parseAsset(params.asset);

    const assetData = findAssetByFormat(params.asset);
    if (!isFinAsset(assetData)) {
      throw new RujiraError(RujiraErrorCode.INVALID_ASSET, `Unknown asset: ${params.asset}`);
    }

    const denom = assetData.formats.fin;

    this.validateL1Address(chain, params.l1Address);

    const memo = this.buildWithdrawMemo(params.asset, params.l1Address);

    const estimatedFee = await this.estimateWithdrawFee(params.asset, params.amount);

    try {
      if (BigInt(params.amount) <= BigInt(estimatedFee)) {
        throw new RujiraError(
          RujiraErrorCode.INVALID_AMOUNT,
          `Withdrawal amount (${params.amount}) is too small to cover estimated outbound fee (${estimatedFee}) for ${params.asset}. ` +
            'Try a larger amount or wait for lower gas.'
        );
      }
    } catch {
      // ignore bigint parse issues; THORChain validates on-chain
    }

    const funds: Coin[] = [
      {
        denom,
        amount: params.amount,
      },
    ];

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
      const senderAddress = await vault.address('THORChain');

      const [accountInfo, fee] = await Promise.all([
        this.getAccountInfo(senderAddress),
        this.getNetworkFee(),
      ]);

      const keysignPayload = await this.buildWithdrawalKeysignPayload({
        vault,
        senderAddress,
        prepared,
        accountInfo,
        fee,
      });

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

      let signature: unknown;
      if (typeof (vault as any).sign === 'function') {
        signature = await (vault as any).sign({
          transaction: keysignPayload,
          chain: 'THORChain',
          messageHashes,
        });
      } else {
        throw new RujiraError(RujiraErrorCode.SIGNING_FAILED, 'Vault does not support sign()');
      }

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

  private async buildWithdrawalKeysignPayload(params: {
    vault: VultisigVault;
    senderAddress: string;
    prepared: PreparedWithdraw;
    accountInfo: { accountNumber: string; sequence: string };
    fee: bigint;
  }): Promise<KeysignPayload> {
    const { vault, senderAddress, prepared, accountInfo, fee } = params;

    const { chain: thorchainChainId, symbol: fullSymbol } = this.parseAsset(prepared.asset);
    const ticker = fullSymbol.split('-')[0] || fullSymbol;

    const l1Chain = THORCHAIN_TO_SDK_CHAIN[thorchainChainId] || thorchainChainId;

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

    const contractAddress = fullSymbol.includes('-')
      ? fullSymbol.split('-')[1]?.toUpperCase() || ''
      : '';

    const keysignPayload: KeysignPayload = {
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
      toAddress: '',
      toAmount: prepared.amount,
      blockchainSpecific: {
        case: 'thorchainSpecific',
        value: {
          accountNumber: BigInt(accountInfo.accountNumber),
          sequence: BigInt(accountInfo.sequence),
          fee: fee,
          isDeposit: true,
          transactionType: 0,
        },
      },
      memo: prepared.memo,
      vaultPublicKeyEcdsa: vault.publicKeys.ecdsa,
      vaultLocalPartyId: basePayload.vaultLocalPartyId || '',
      libType: basePayload.libType || 'GG20',
      utxoInfo: [],
      swapPayload: {
        case: 'thorchainSwapPayload',
        value: {
          fromAddress: senderAddress,
          fromCoin: {
            chain: l1Chain,
            ticker: ticker,
            contractAddress: contractAddress,
            decimals: THORCHAIN_DECIMALS,
            address: '',
            priceProviderId: '',
            isNativeToken: fullSymbol === ticker,
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

  private async getAccountInfo(address: string): Promise<{ accountNumber: string; sequence: string }> {
    try {
      const response = await fetch(`${this.thornodeUrl}/auth/accounts/${address}`);

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
      const response = await fetch(`${this.thornodeUrl}/thorchain/network`);

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

  buildWithdrawMemo(_asset: string, l1Address: string): string {
    return `secure-:${l1Address}`;
  }

  estimateWithdrawTime(chain: string): number {
    return CHAIN_WITHDRAWAL_TIMES[chain.toUpperCase()] || 15;
  }

  async estimateWithdrawFee(asset: string, _amount: string): Promise<string> {
    const { chain } = this.parseAsset(asset);

    let gasAssetOutboundFee = '0';
    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
      if (response.ok) {
        const addresses = (await response.json()) as Array<{ chain: string; outbound_fee: string }>;
        const chainInfo = addresses.find((a) => a.chain === chain);
        if (chainInfo?.outbound_fee) {
          gasAssetOutboundFee = chainInfo.outbound_fee;
        }
      }
    } catch {
      // ignore and fall back below
    }

    if (gasAssetOutboundFee === '0') {
      const defaultGasFees: Record<string, string> = {
        BTC: '30000',
        ETH: '9146',
        BSC: '3000',
        AVAX: '2291640',
        GAIA: '11998200',
        DOGE: '100000000',
        LTC: '100000',
        BCH: '10000',
      };
      gasAssetOutboundFee = defaultGasFees[chain] || '0';
    }

    if (asset.toUpperCase() === `${chain}.${chain}`) {
      return gasAssetOutboundFee;
    }

    try {
      const gasPoolAsset = `${chain}.${chain}`;

      const [gasPoolResp, targetPoolResp] = await Promise.all([
        fetch(`${this.thornodeUrl}/thorchain/pool/${gasPoolAsset}`),
        fetch(`${this.thornodeUrl}/thorchain/pool/${asset.toUpperCase()}`),
      ]);

      if (!gasPoolResp.ok || !targetPoolResp.ok) {
        return gasAssetOutboundFee;
      }

      const gasPool = (await gasPoolResp.json()) as { balance_asset: string; balance_rune: string };
      const targetPool = (await targetPoolResp.json()) as {
        balance_asset: string;
        balance_rune: string;
      };

      const gasFee = BigInt(gasAssetOutboundFee);
      const gasBalAsset = BigInt(gasPool.balance_asset);
      const gasBalRune = BigInt(gasPool.balance_rune);
      const tgtBalAsset = BigInt(targetPool.balance_asset);
      const tgtBalRune = BigInt(targetPool.balance_rune);

      if (
        gasFee === 0n ||
        gasBalAsset === 0n ||
        gasBalRune === 0n ||
        tgtBalAsset === 0n ||
        tgtBalRune === 0n
      ) {
        return gasAssetOutboundFee;
      }

      const runeFee = (gasFee * gasBalRune) / gasBalAsset;
      const assetFee = (runeFee * tgtBalAsset) / tgtBalRune;

      return assetFee.toString();
    } catch {
      return gasAssetOutboundFee;
    }
  }

  async getMinimumWithdraw(asset: string): Promise<string> {
    const { chain } = this.parseAsset(asset);

    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
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
    const { chain } = this.parseAsset(asset);

    try {
      const response = await fetch(`${this.thornodeUrl}/thorchain/inbound_addresses`);
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

  private validateL1Address(chain: string, address: string): void {
    const validators: Record<string, (addr: string) => boolean> = {
      BTC: (addr) =>
        /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
        /^bc1[a-z0-9]{39,87}$/.test(addr),
      ETH: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      BSC: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      AVAX: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      GAIA: (addr) => /^cosmos1[a-z0-9]{38}$/.test(addr),
      DOGE: (addr) => /^D[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr),
      LTC: (addr) =>
        /^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
        /^ltc1[a-z0-9]{39,87}$/.test(addr),
      BCH: (addr) =>
        /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
        /^bitcoincash:[qp][a-z0-9]{41}$/.test(addr) ||
        /^[qp][a-z0-9]{41}$/.test(addr),
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
