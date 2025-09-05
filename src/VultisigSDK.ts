import type {
  Vault,
  ChainKind,
  Balance,
  ServerStatus
} from './types'

import { Chain } from '@core/chain/Chain'

import { VaultManager } from './vault'
import { MPCManager } from './mpc'
import { ChainManager } from './chains'
import { AddressDeriver } from './chains/AddressDeriver'
import { ServerManager } from './server'
import { WASMManager } from './wasm'

/**
 * Main VultisigSDK class providing secure multi-party computation and blockchain operations
 * 
 * Features:
 * - Multi-device vault creation and management
 * - Secure transaction signing via MPC
 * - Multi-chain blockchain support  
 * - Server-assisted operations (Fast Vault)
 * - Cross-device message relay
 */
export class VultisigSDK {
  private _vaultManager: VaultManager
  private mpcManager: MPCManager
  private chainManager: ChainManager
  private addressDeriver: AddressDeriver
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private initialized = false

  constructor(config?: {
    serverEndpoints?: {
      fastVault?: string
      messageRelay?: string
    }
    wasmConfig?: {
      autoInit?: boolean
      wasmPaths?: {
        walletCore?: string
        dkls?: string
        schnorr?: string
      }
    }
  }) {
    this.wasmManager = new WASMManager(config?.wasmConfig)
    this.serverManager = new ServerManager(config?.serverEndpoints)
    this._vaultManager = new VaultManager()
    this.mpcManager = new MPCManager(this.serverManager)
    this.chainManager = new ChainManager(this.wasmManager)
    this.addressDeriver = new AddressDeriver()
  }

  /**
   * Initialize the SDK and load WASM modules
   * Automatically initializes VaultManager with this SDK instance
   */
  async init(): Promise<void> {
    if (this.initialized) return
    
    try {
      // Initialize WASM directly like the working version
      await this.wasmManager.initialize()
      const walletCore = await this.wasmManager.getWalletCore()
      
      // Initialize the AddressDeriver with WalletCore
      await this.addressDeriver.initialize(walletCore)
      
      // Auto-initialize VaultManager with this SDK instance
      VaultManager.init(this)
      
      this.initialized = true
    } catch (error) {
      throw new Error('Failed to initialize SDK: ' + (error as Error).message)
    }
  }

  /**
   * Check if SDK is initialized
   */
  async isInitialized(): Promise<boolean> {
    return this.initialized
  }

  // ===== VAULT OPERATIONS =====
  /** Access to VaultManager static class */
  get vaultManager() { return VaultManager }


  // ===== Server status and health =====

  /**
   * Check VultiServer status and connectivity
   */
  async checkServerStatus(): Promise<ServerStatus> {
    return this.serverManager.checkServerStatus()
  }


  // ===== Server status and health =====

  /**
   * Get server status (alias for checkServerStatus)
   */
  async getServerStatus(): Promise<ServerStatus> {
    return this.checkServerStatus()
  }


}