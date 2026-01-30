import {
  CosmWasmClient,
  ExecuteResult,
  SigningCosmWasmClient,
} from '@cosmjs/cosmwasm-stargate';
import { Coin } from '@cosmjs/proto-signing';
import { GasPrice, StargateClient } from '@cosmjs/stargate';

import { getNetworkConfig, type NetworkType, type RujiraConfig } from './config.js';
import { RujiraError, RujiraErrorCode, wrapError } from './errors.js';
import { RujiraDiscovery } from './discovery/discovery.js';
import { RujiraAssets } from './modules/assets.js';
import { RujiraDeposit } from './modules/deposit.js';
import { RujiraOrderbook } from './modules/orderbook.js';
import { RujiraSwap, type RujiraSwapOptions } from './modules/swap.js';
import { RujiraWithdraw } from './modules/withdraw.js';
import type { RujiraSigner } from './signer/types.js';
import type { BookResponse, FinQueryMsg, SimulationResponse } from './types.js';

export interface RujiraClientOptions {
  network?: NetworkType;
  config?: Partial<RujiraConfig>;
  signer?: RujiraSigner;
  rpcEndpoint?: string;
  contractCache?: {
    load?: () => Promise<Record<string, string>> | Record<string, string>;
    save?: (finContracts: Record<string, string>) => Promise<void> | void;
  };
  debug?: boolean;
  swapOptions?: RujiraSwapOptions;
}

export class RujiraClient {
  public readonly config: RujiraConfig;

  public readonly swap: RujiraSwap;
  public readonly orderbook: RujiraOrderbook;
  public readonly assets: RujiraAssets;
  public readonly deposit: RujiraDeposit;
  public readonly withdraw: RujiraWithdraw;
  public readonly discovery: RujiraDiscovery;

  private queryClient: CosmWasmClient | null = null;
  private stargateClient: StargateClient | null = null;
  private signingClient: SigningCosmWasmClient | null = null;

  private signer: RujiraSigner | null = null;
  private contractCache?: RujiraClientOptions['contractCache'];
  private debug: boolean;

  constructor(options: RujiraClientOptions = {}) {
    const networkConfig = getNetworkConfig(options.network ?? 'mainnet');

    this.config = {
      ...networkConfig,
      ...options.config,
      contracts: {
        ...networkConfig.contracts,
        ...options.config?.contracts,
      },
    };

    if (options.rpcEndpoint) {
      this.config.rpcEndpoint = options.rpcEndpoint;
    }

    this.signer = options.signer || null;
    this.contractCache = options.contractCache;
    this.debug = options.debug || false;

    this.swap = new RujiraSwap(this, options.swapOptions);
    this.orderbook = new RujiraOrderbook(this);
    this.assets = new RujiraAssets(this);
    this.deposit = new RujiraDeposit(this);
    this.withdraw = new RujiraWithdraw(this);

    this.discovery = new RujiraDiscovery({
      network: options.network || 'mainnet',
      rpcEndpoint: this.config.rpcEndpoint,
      debug: this.debug,
    });
  }

  async connect(): Promise<void> {
    try {
      this.log('Connecting to', this.config.rpcEndpoint);

      if (this.contractCache?.load) {
        try {
          const loaded = await this.contractCache.load();
          this.config.contracts.finContracts = {
            ...this.config.contracts.finContracts,
            ...(loaded ?? {}),
          };
          this.log('Loaded persisted FIN contracts:', Object.keys(loaded ?? {}).length);
        } catch (e) {
          this.log('Failed to load persisted FIN contracts (continuing):', e);
        }
      }

      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
      this.log('CosmWasm query client connected');

      this.stargateClient = await StargateClient.connect(this.config.rpcEndpoint);
      this.log('Stargate client connected');

      if (this.signer) {
        this.signingClient = await SigningCosmWasmClient.connectWithSigner(
          this.config.rpcEndpoint,
          this.signer,
          { gasPrice: GasPrice.fromString(this.config.gasPrice) }
        );
        this.log('Signing client connected');
      }
    } catch (error) {
      throw wrapError(error, RujiraErrorCode.NETWORK_ERROR);
    }
  }

  disconnect(): void {
    this.queryClient?.disconnect();
    this.queryClient = null;

    this.stargateClient?.disconnect();
    this.stargateClient = null;

    this.signingClient?.disconnect();
    this.signingClient = null;

    this.log('Disconnected');
  }

  isConnected(): boolean {
    return this.queryClient !== null;
  }

  canSign(): boolean {
    return this.signingClient !== null;
  }

  async getAddress(): Promise<string> {
    if (!this.signer) {
      throw new RujiraError(RujiraErrorCode.MISSING_SIGNER, 'No signer provided');
    }
    const accounts = await this.signer.getAccounts();
    return accounts[0].address;
  }

  async getBalance(address: string, denom: string): Promise<Coin> {
    this.ensureConnected();

    if (this.stargateClient) {
      return this.stargateClient.getBalance(address, denom);
    }

    return this.queryClient!.getBalance(address, denom);
  }

  async getAllBalances(address: string): Promise<readonly Coin[]> {
    this.ensureConnected();

    if (!this.stargateClient) {
      throw new RujiraError(
        RujiraErrorCode.NOT_CONNECTED,
        'Stargate client not available. Call connect() first.'
      );
    }

    return this.stargateClient.getAllBalances(address);
  }

  async persistFinContracts(): Promise<void> {
    if (!this.contractCache?.save) return;
    await this.contractCache.save(this.config.contracts.finContracts);
  }

  async queryContract<T>(contractAddress: string, query: object): Promise<T> {
    this.ensureConnected();

    this.log('Query contract:', contractAddress, query);

    try {
      const result = await this.queryClient!.queryContractSmart(contractAddress, query);
      this.log('Query result:', result);
      return result as T;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('out of gas')) {
        try {
          const result = await this.queryContractViaRest<T>(contractAddress, query);
          this.log('Query result (REST fallback):', result);
          return result;
        } catch (fallbackError) {
          throw wrapError(fallbackError, RujiraErrorCode.CONTRACT_ERROR);
        }
      }

      throw wrapError(error, RujiraErrorCode.CONTRACT_ERROR);
    }
  }

  private async queryContractViaRest<T>(
    contractAddress: string,
    query: object
  ): Promise<T> {
    const encoded = Buffer.from(JSON.stringify(query)).toString('base64');

    const base = this.config.restEndpoint.replace(/\/$/, '');
    const url = `${base}/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${encoded}?gas_limit=${this.config.wasmQueryGasLimit}`;

    this.log('Query contract (REST):', url);

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`REST smart query failed (${res.status}): ${text || res.statusText}`);
    }

    const data = (await res.json()) as { data: unknown };
    return data.data as T;
  }

  async executeContract(
    contractAddress: string,
    msg: object,
    funds: Coin[] = [],
    memo?: string
  ): Promise<ExecuteResult> {
    this.ensureSigner();

    const address = await this.getAddress();

    try {
      this.log('Execute contract:', contractAddress, msg, funds);
      const result = await this.signingClient!.execute(
        address,
        contractAddress,
        msg,
        'auto',
        memo,
        funds
      );
      this.log('Execute result:', result.transactionHash);
      return result;
    } catch (error) {
      throw wrapError(error, RujiraErrorCode.CONTRACT_ERROR);
    }
  }

  async simulateSwap(contractAddress: string, denom: string, amount: string): Promise<SimulationResponse> {
    const query: FinQueryMsg = {
      simulate: { denom, amount },
    };
    return this.queryContract<SimulationResponse>(contractAddress, query);
  }

  async getOrderBook(contractAddress: string, limit = 10, offset = 0): Promise<BookResponse> {
    const query: FinQueryMsg = {
      book: { limit, offset },
    };
    return this.queryContract<BookResponse>(contractAddress, query);
  }

  async waitForTransaction(
    txHash: string,
    timeoutMs = 60000
  ): Promise<{ code: number; height: number; rawLog?: string }> {
    this.ensureConnected();

    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const tx = await this.queryClient!.getTx(txHash);
        if (tx) {
          return {
            code: tx.code,
            height: tx.height,
            rawLog: tx.rawLog,
          };
        }
      } catch {
        // keep polling
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new RujiraError(
      RujiraErrorCode.TIMEOUT,
      `Transaction ${txHash} not found within ${timeoutMs}ms`
    );
  }

  async getBlockHeight(): Promise<number> {
    this.ensureConnected();
    return this.queryClient!.getHeight();
  }

  private ensureConnected(): void {
    if (!this.queryClient || !this.stargateClient) {
      throw new RujiraError(
        RujiraErrorCode.NOT_CONNECTED,
        'Client not connected. Call connect() first.'
      );
    }
  }

  private ensureSigner(): void {
    this.ensureConnected();
    if (!this.signingClient) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'No signer provided. Initialize client with a signer for transactions.'
      );
    }
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[RujiraClient]', ...args);
    }
  }
}
