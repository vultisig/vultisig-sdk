/**
 * Main Rujira client
 * @module client
 */

import { 
  CosmWasmClient, 
  SigningCosmWasmClient,
  ExecuteResult 
} from '@cosmjs/cosmwasm-stargate';
import { GasPrice } from '@cosmjs/stargate';
import { Coin } from '@cosmjs/proto-signing';

import { 
  RujiraConfig, 
  NetworkType, 
  getNetworkConfig
} from './config';
import { RujiraError, RujiraErrorCode, wrapError } from './errors';
import { RujiraSwap, type RujiraSwapOptions } from './modules/swap';
import { RujiraOrderbook } from './modules/orderbook';
import { RujiraAssets } from './modules/assets';
import { RujiraDeposit } from './modules/deposit';
import { RujiraWithdraw } from './modules/withdraw';
import { RujiraDiscovery, type DiscoveryOptions } from './discovery/discovery';
import type { RujiraSigner } from './signer/types';
import type { 
  FinQueryMsg, 
  SimulationResponse, 
  BookResponse
} from './types';

/**
 * Options for RujiraClient initialization
 */
export interface RujiraClientOptions {
  /** Network to connect to */
  network?: NetworkType;
  /** Custom configuration (overrides network defaults) */
  config?: Partial<RujiraConfig>;
  /** Signer for transactions (optional for read-only) */
  signer?: RujiraSigner;
  /** Custom RPC endpoint */
  rpcEndpoint?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Swap module options (including cache settings) */
  swapOptions?: RujiraSwapOptions;
}

/**
 * Main client for interacting with Rujira DEX
 * 
 * @example
 * ```typescript
 * // Read-only client
 * const client = new RujiraClient({ network: 'mainnet' });
 * await client.connect();
 * 
 * // With signer for transactions
 * const signer = new VultisigRujiraProvider(vault);
 * const client = new RujiraClient({ network: 'mainnet', signer });
 * await client.connect();
 * ```
 */
export class RujiraClient {
  /** Network configuration */
  public readonly config: RujiraConfig;
  
  /** Swap module */
  public readonly swap: RujiraSwap;
  
  /** Orderbook module */
  public readonly orderbook: RujiraOrderbook;
  
  /** Assets module */
  public readonly assets: RujiraAssets;

  /** Deposit module for securing L1 assets */
  public readonly deposit: RujiraDeposit;

  /** Withdraw module for withdrawing secured assets to L1 */
  public readonly withdraw: RujiraWithdraw;

  /** Contract discovery module */
  public readonly discovery: RujiraDiscovery;

  /** Query client (read-only) */
  private queryClient: CosmWasmClient | null = null;
  
  /** Signing client (for transactions) */
  private signingClient: SigningCosmWasmClient | null = null;
  
  /** Signer instance */
  private signer: RujiraSigner | null = null;
  
  /** Debug mode */
  private debug: boolean;

  constructor(options: RujiraClientOptions = {}) {
    // Build configuration
    const networkConfig = options.network 
      ? getNetworkConfig(options.network)
      : getNetworkConfig('mainnet');
    
    this.config = {
      ...networkConfig,
      ...options.config,
      contracts: {
        ...networkConfig.contracts,
        ...options.config?.contracts,
      },
    };

    // Override RPC if provided
    if (options.rpcEndpoint) {
      this.config.rpcEndpoint = options.rpcEndpoint;
    }

    this.signer = options.signer || null;
    this.debug = options.debug || false;

    // Initialize modules
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

  /**
   * Connect to the network
   */
  async connect(): Promise<void> {
    try {
      this.log('Connecting to', this.config.rpcEndpoint);
      
      // Create query client
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
      this.log('Query client connected');

      // Create signing client if signer provided
      if (this.signer) {
        this.signingClient = await SigningCosmWasmClient.connectWithSigner(
          this.config.rpcEndpoint,
          this.signer,
          {
            gasPrice: GasPrice.fromString(this.config.gasPrice),
          }
        );
        this.log('Signing client connected');
      }
    } catch (error) {
      throw wrapError(error, RujiraErrorCode.NETWORK_ERROR);
    }
  }

  /**
   * Disconnect from the network
   */
  disconnect(): void {
    if (this.queryClient) {
      this.queryClient.disconnect();
      this.queryClient = null;
    }
    if (this.signingClient) {
      this.signingClient.disconnect();
      this.signingClient = null;
    }
    this.log('Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.queryClient !== null;
  }

  /**
   * Check if can sign transactions
   */
  canSign(): boolean {
    return this.signingClient !== null;
  }

  /**
   * Get the connected address
   */
  async getAddress(): Promise<string> {
    if (!this.signer) {
      throw new RujiraError(
        RujiraErrorCode.MISSING_SIGNER,
        'No signer provided'
      );
    }
    const accounts = await this.signer.getAccounts();
    return accounts[0].address;
  }

  /**
   * Get account balance
   */
  async getBalance(address: string, denom: string): Promise<Coin> {
    this.ensureConnected();
    return this.queryClient!.getBalance(address, denom);
  }

  /**
   * Get all balances for an address
   * Note: Use getBalance for specific denoms as CosmWasm client may not support getAllBalances
   */
  async getAllBalances(address: string): Promise<Coin[]> {
    this.ensureConnected();
    // CosmWasmClient doesn't have getAllBalances, need to use stargate client
    // For now, return empty - would need StargateClient for full balance query
    console.warn('getAllBalances not fully implemented - use getBalance with specific denom');
    const runeBalance = await this.queryClient!.getBalance(address, 'rune');
    return [runeBalance];
  }

  // ============================================================================
  // CONTRACT INTERACTIONS
  // ============================================================================

  /**
   * Query a smart contract
   */
  async queryContract<T>(
    contractAddress: string,
    query: object
  ): Promise<T> {
    this.ensureConnected();
    try {
      this.log('Query contract:', contractAddress, query);
      const result = await this.queryClient!.queryContractSmart(
        contractAddress,
        query
      );
      this.log('Query result:', result);
      return result as T;
    } catch (error) {
      throw wrapError(error, RujiraErrorCode.CONTRACT_ERROR);
    }
  }

  /**
   * Execute a contract method
   */
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

  /**
   * Simulate a swap on FIN contract
   */
  async simulateSwap(
    contractAddress: string,
    denom: string,
    amount: string
  ): Promise<SimulationResponse> {
    const query: FinQueryMsg = {
      simulate: { denom, amount }
    };
    return this.queryContract<SimulationResponse>(contractAddress, query);
  }

  /**
   * Get order book from FIN contract
   */
  async getOrderBook(
    contractAddress: string,
    limit = 50,
    offset = 0
  ): Promise<BookResponse> {
    const query: FinQueryMsg = {
      book: { limit, offset }
    };
    return this.queryContract<BookResponse>(contractAddress, query);
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Wait for a transaction to be included
   */
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
        // Transaction not found yet, continue polling
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new RujiraError(
      RujiraErrorCode.TIMEOUT,
      `Transaction ${txHash} not found within ${timeoutMs}ms`
    );
  }

  /**
   * Get current block height
   */
  async getBlockHeight(): Promise<number> {
    this.ensureConnected();
    return this.queryClient!.getHeight();
  }

  // ============================================================================
  // INTERNAL
  // ============================================================================

  private ensureConnected(): void {
    if (!this.queryClient) {
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
