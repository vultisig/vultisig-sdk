import { VaultManager } from './VaultManager'
import type { SDKConfig, ServerStatus, ValidationResult } from './types'

export class VultisigSDK {
  private initialized = false
  private config: SDKConfig

  constructor(config?: SDKConfig) {
    this.config = {
      // Default configuration
      defaultTimeout: 30000,
      retryAttempts: 3,
      maxConcurrentRequests: 10,
      cacheConfig: {
        addressTTL: -1, // Permanent
        balanceTTL: 300000, // 5 minutes
        gasTTL: 30000, // 30 seconds
        priceTTL: 60000 // 1 minute
      },
      wasmConfig: {
        autoInit: true
      },
      vaultManagerConfig: {
        defaultChains: ['bitcoin', 'ethereum', 'solana'],
        defaultCurrency: 'USD'
      },
      // Override with provided config
      ...config
    }

    // Initialize VaultManager
    VaultManager.init(this, this.config.vaultManagerConfig)
    
    // Apply default settings
    if (this.config.vaultManagerConfig?.defaultChains) {
      VaultManager.setDefaultChains(this.config.vaultManagerConfig.defaultChains)
    }
    if (this.config.vaultManagerConfig?.defaultCurrency) {
      VaultManager.setDefaultCurrency(this.config.vaultManagerConfig.defaultCurrency)
    }
  }

  // === INITIALIZATION ===
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('🔧 Initializing VultisigSDK...')

    // Mock WASM initialization
    if (this.config.wasmConfig?.autoInit) {
      console.log('⚙️ Initializing WASM modules...')
      await new Promise(resolve => setTimeout(resolve, 200)) // Mock delay
      console.log('✅ WASM modules initialized')
    }

    // Mock server connectivity check
    console.log('🌐 Checking server connectivity...')
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log('✅ Server connectivity verified')

    this.initialized = true
    console.log('✅ VultisigSDK initialized successfully')
  }

  isInitialized(): boolean {
    return this.initialized
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // === VAULT OPERATIONS ===
  get vaultManager() {
    return VaultManager
  }

  // === CHAIN OPERATIONS ===
  getSupportedChains(): string[] {
    return [
      'bitcoin',
      'ethereum',
      'solana',
      'litecoin',
      'dogecoin',
      'avalanche',
      'polygon',
      'bsc',
      'optimism',
      'arbitrum',
      'base',
      'thorchain',
      'cosmos',
      'mayachain',
      'cardano',
      'polkadot',
      'ripple',
      'tron',
      'sui',
      'ton'
    ]
  }

  // === VALIDATION HELPERS ===
  static validateEmail(email: string): ValidationResult {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const isValid = emailRegex.test(email)
    
    return {
      isValid,
      errors: isValid ? undefined : ['Invalid email format']
    }
  }

  static validatePassword(password: string): ValidationResult {
    const errors: string[] = []
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long')
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter')
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter')
    }
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number')
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character')
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    }
  }

  static validateVaultName(name: string): ValidationResult {
    const errors: string[] = []
    
    if (!name || name.trim().length === 0) {
      errors.push('Vault name cannot be empty')
    }
    if (name.length > 50) {
      errors.push('Vault name cannot exceed 50 characters')
    }
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
      errors.push('Vault name can only contain letters, numbers, spaces, hyphens, and underscores')
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    }
  }

  // === SERVER STATUS ===
  async getServerStatus(): Promise<ServerStatus> {
    await this.ensureInitialized()

    // Mock server status check
    const isOnline = Math.random() > 0.1 // 90% chance of being online

    return {
      vultiServer: isOnline ? 'online' : 'offline',
      messageRelay: isOnline ? 'online' : 'offline',
      lastChecked: Date.now()
    }
  }

  // === CONFIGURATION ===
  getConfig(): SDKConfig {
    return { ...this.config }
  }

  async updateConfig(config: Partial<SDKConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
    
    // Update VaultManager config if provided
    if (config.vaultManagerConfig) {
      VaultManager.saveConfig(config.vaultManagerConfig)
      
      if (config.vaultManagerConfig.defaultChains) {
        await VaultManager.setDefaultChains(config.vaultManagerConfig.defaultChains)
      }
      if (config.vaultManagerConfig.defaultCurrency) {
        await VaultManager.setDefaultCurrency(config.vaultManagerConfig.defaultCurrency)
      }
    }
  }

  // === PRIVATE METHODS ===
  private configureProviders(config?: SDKConfig): void {
    // Mock provider configuration
    console.log('🔧 Configuring network providers...')
    
    if (config?.rpcEndpoints) {
      console.log(`📡 Custom RPC endpoints: ${Object.keys(config.rpcEndpoints).length}`)
    }
    
    if (config?.serverEndpoints) {
      console.log('🌐 Custom server endpoints configured')
    }
  }
}
