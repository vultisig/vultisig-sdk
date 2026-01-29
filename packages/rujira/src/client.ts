/**
 * Main Rujira client - Central coordination hub for all SDK operations
 * 
 * The RujiraClient acts as the primary entry point for interacting with Rujira DEX.
 * It manages network connections, coordinates between modules, and handles authentication.
 * 
 * Key responsibilities:
 * - Network connection management (read-only and signing clients)
 * - Module initialization and coordination
 * - Contract discovery and caching
 * - Transaction signing and broadcasting
 * - Error handling and recovery
 * 
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
 * Configuration options for initializing the RujiraClient
 * 
 * This interface allows fine-tuning of the client's behavior across different
 * environments and use cases. The client adapts its functionality based on
 * whether a signer is provided (read-only vs. transactional mode).
 */
export interface RujiraClientOptions {
  /** 
   * Blockchain network to connect to
   * @default 'mainnet'
   */
  network?: NetworkType;
  
  /** 
   * Custom configuration overrides for network settings
   * Useful for custom endpoints, gas settings, or contract addresses
   */
  config?: Partial<RujiraConfig>;
  
  /** 
   * Transaction signer (required for executing swaps/orders)
   * If not provided, client operates in read-only mode (quotes only)
   */
  signer?: RujiraSigner;
  
  /** 
   * Custom RPC endpoint override
   * Useful for load balancing or private RPC endpoints
   */
  rpcEndpoint?: string;
  
  /** 
   * Enable verbose logging for debugging
   * @default false
   */
  debug?: boolean;
  
  /** 
   * Swap module configuration (caching, quote expiry, etc.)
   * Controls quote caching behavior and safety buffers
   */
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
    // Build network configuration with user overrides
    // Network configs provide sensible defaults for each environment (mainnet/stagenet/localnet)
    const networkConfig = options.network 
      ? getNetworkConfig(options.network)
      : getNetworkConfig('mainnet');
    
    // Merge network config with user overrides
    // Deep merge contract addresses to preserve existing entries while allowing additions
    this.config = {
      ...networkConfig,
      ...options.config,
      contracts: {
        ...networkConfig.contracts,
        ...options.config?.contracts,
      },
    };

    // Apply RPC endpoint override if provided
    // This is common for users with custom/private RPC endpoints
    if (options.rpcEndpoint) {
      this.config.rpcEndpoint = options.rpcEndpoint;
    }

    // Store authentication and debugging preferences
    this.signer = options.signer || null;
    this.debug = options.debug || false;

    // Initialize all modules with appropriate configuration
    // Each module receives a reference to this client for coordination
    // Order matters here - some modules may depend on others during initialization
    this.swap = new RujiraSwap(this, options.swapOptions);
    this.orderbook = new RujiraOrderbook(this);
    this.assets = new RujiraAssets(this);
    this.deposit = new RujiraDeposit(this);
    this.withdraw = new RujiraWithdraw(this);
    
    // Discovery module needs independent configuration for fallback scenarios
    // It maintains its own RPC client for contract discovery when GraphQL fails
    this.discovery = new RujiraDiscovery({
      network: options.network || 'mainnet',
      rpcEndpoint: this.config.rpcEndpoint,
      debug: this.debug,
    });
  }

  /**
   * Establish connection to the THORChain network
   * 
   * This method must be called before using the client. It creates the necessary
   * CosmWasm clients for querying and (optionally) signing transactions.
   * 
   * Connection behavior:
   * - Always creates a query client for read operations (quotes, balances, etc.)
   * - Creates signing client only if signer was provided during initialization
   * - Uses configured gas price for all transactions
   * - Validates network connectivity and throws descriptive errors on failure
   * 
   * @throws {RujiraError} With NETWORK_ERROR code if connection fails
   * 
   * @example
   * ```typescript
   * const client = new RujiraClient({ network: 'mainnet' });
   * await client.connect();
   * 
   * // Now ready for read operations
   * const quote = await client.swap.getQuote({...});
   * ```
   */
  async connect(): Promise<void> {
    try {
      this.log('Connecting to', this.config.rpcEndpoint);
      
      // Create query client for read-only operations (always needed)
      // This client can query balances, contracts, and chain state
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
      this.log('Query client connected');

      // Create signing client only if signer is available
      // This enables transaction execution (swaps, orders, etc.)
      if (this.signer) {
        this.signingClient = await SigningCosmWasmClient.connectWithSigner(
          this.config.rpcEndpoint,
          this.signer,
          {
            // Use configured gas price for all transactions
            // This ensures consistent fee estimation across operations
            gasPrice: GasPrice.fromString(this.config.gasPrice),
          }
        );
        this.log('Signing client connected');
      }
    } catch (error) {
      // Convert network errors to descriptive RujiraErrors
      // This provides better error messages for common connectivity issues
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
   * 
   * Note: This queries common Rujira assets. For a complete balance list,
   * use a dedicated balance service or query specific denoms with getBalance().
   */
  async getAllBalances(address: string): Promise<Coin[]> {
    this.ensureConnected();
    
    // Query common Rujira assets in parallel
    // CosmWasmClient doesn't have getAllBalances, so we query known denoms
    const commonDenoms = [
      'rune',                    // Native RUNE
      'btc-btc',                 // Secured BTC
      'eth-eth',                 // Secured ETH
      'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      'eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    ];
    
    const balances = await Promise.all(
      commonDenoms.map(async (denom) => {
        try {
          return await this.queryClient!.getBalance(address, denom);
        } catch {
          return { denom, amount: '0' };
        }
      })
    );
    
    // Filter out zero balances
    return balances.filter(b => b.amount !== '0');
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
