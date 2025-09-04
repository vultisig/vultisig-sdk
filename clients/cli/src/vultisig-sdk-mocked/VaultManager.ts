import { Vault } from './Vault'
import type {
  VaultManagerConfig,
  VaultType,
  KeygenMode,
  VaultCreationStep,
  Summary,
  AddressBook,
  AddressBookEntry,
  VaultSigner
} from './types'

export class VaultManager {
  // === GLOBAL SETTINGS ===
  static config: VaultManagerConfig = {
    defaultChains: ['bitcoin', 'ethereum', 'solana'],
    defaultCurrency: 'USD'
  }
  
  private static sdkInstance: any = null
  private static activeVault: Vault | null = null
  private static vaultStorage: Map<string, Vault> = new Map()
  private static addressBookStorage: AddressBookEntry[] = []

  // === INITIALIZATION ===
  static init(sdk: any, config?: Partial<VaultManagerConfig>): void {
    this.sdkInstance = sdk
    if (config) {
      this.config = { ...this.config, ...config }
    }
  }

  // === VAULT LIFECYCLE ===
  static async create(
    name: string,
    options?: {
      type?: VaultType
      keygenMode?: KeygenMode
      password?: string
      email?: string
      onProgress?: (step: VaultCreationStep) => void
    }
  ): Promise<Vault> {
    const type = options?.type || 'fast'
    const keygenMode = options?.keygenMode || (type === 'fast' ? 'fast' : 'relay')

    // Mock progress updates
    if (options?.onProgress) {
      const steps: VaultCreationStep[] = [
        { step: 'initializing', progress: 10, message: 'Initializing vault creation' },
        { step: 'keygen', progress: 30, message: `Generating keys using ${keygenMode} mode` },
        { step: 'deriving_addresses', progress: 60, message: 'Deriving addresses for chains' },
        { step: 'fetching_balances', progress: 80, message: 'Fetching initial balances' },
        { step: 'applying_tokens', progress: 90, message: 'Adding default tokens' },
        { step: 'complete', progress: 100, message: 'Vault creation complete' }
      ]

      for (const step of steps) {
        options.onProgress(step)
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    // Create mock signers
    const totalSigners = type === 'fast' ? 2 : 3
    const threshold = type === 'fast' ? 2 : 2
    
    const signers: VaultSigner[] = []
    for (let i = 0; i < totalSigners; i++) {
      signers.push({
        id: `signer-${i + 1}`,
        publicKey: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        name: i === 0 ? 'This Device' : (i === 1 && type === 'fast' ? 'VultiServer' : `Device ${i + 1}`)
      })
    }

    // Create vault summary
    const summary: Summary = {
      id: 'vault-' + Math.random().toString(36).substr(2, 9),
      name,
      isEncrypted: !!options?.password,
      createdAt: Date.now(),
      lastModified: Date.now(),
      size: 1024, // Mock size
      type,
      currency: this.config.defaultCurrency,
      chains: [...this.config.defaultChains],
      tokens: {},
      threshold,
      totalSigners,
      vaultIndex: 0,
      signers,
      keys: {
        ecdsa: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        eddsa: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        hexChainCode: Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        hexEncryptionKey: Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
      }
    }

    const vault = new Vault(summary)
    
    // Apply global configuration
    this.applyConfig(vault)
    
    // Store and set as active
    this.vaultStorage.set(summary.id, vault)
    this.activeVault = vault

    return vault
  }

  static async add(file: File, password?: string): Promise<Vault> {
    try {
      const content = await file.text()
      
      // Handle .vult files (base64 encoded protobuf)
      if (file.name.endsWith('.vult')) {
        // For mocked SDK, create a mock vault from .vult filename
        const fileName = file.name.replace('.vult', '')
        const parts = fileName.split('-')
        
        const vaultName = parts[0] || 'Imported Vault'
        const shortId = parts[1] || 'mock'
        const shareInfo = parts[2] || 'share1of2'
        const passwordHint = parts[3] || ''
        
        // Extract share info
        const shareMatch = shareInfo.match(/share(\d+)of(\d+)/)
        const vaultIndex = shareMatch ? parseInt(shareMatch[1]) - 1 : 0
        const totalSigners = shareMatch ? parseInt(shareMatch[2]) : 2
        
        const summary: Summary = {
          id: 'vault-' + shortId,
          name: vaultName,
          isEncrypted: passwordHint.toLowerCase().includes('password') && !passwordHint.toLowerCase().includes('nopassword'),
          createdAt: Date.now(),
          lastModified: Date.now(),
          size: content.length,
          type: totalSigners === 2 ? 'fast' : 'secure',
          currency: this.config.defaultCurrency,
          chains: [...this.config.defaultChains],
          tokens: {},
          threshold: totalSigners === 2 ? 2 : 2,
          totalSigners,
          vaultIndex,
          signers: this.createMockSigners(totalSigners, vaultIndex),
          keys: {
            ecdsa: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
            eddsa: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
            hexChainCode: Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
            hexEncryptionKey: Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
          }
        }

        const vault = new Vault(summary)
        this.applyConfig(vault)
        this.vaultStorage.set(summary.id, vault)
        return vault
      }
      
      // Handle JSON files
      const vaultData = JSON.parse(content)

      // Create summary from imported data
      const summary: Summary = {
        id: vaultData.id || 'imported-' + Math.random().toString(36).substr(2, 9),
        name: vaultData.name || file.name.replace('.json', '').replace('.vult', ''),
        isEncrypted: !!password || vaultData.isEncrypted || false,
        createdAt: vaultData.createdAt || Date.now(),
        lastModified: Date.now(),
        size: content.length,
        type: vaultData.type || (vaultData.totalSigners === 2 ? 'fast' : 'secure'),
        currency: vaultData.currency || this.config.defaultCurrency,
        chains: vaultData.chains || [...this.config.defaultChains],
        tokens: vaultData.tokens || {},
        threshold: vaultData.threshold || 2,
        totalSigners: vaultData.totalSigners || 2,
        vaultIndex: vaultData.vaultIndex || 0,
        signers: vaultData.signers || [
          {
            id: 'imported-signer-1',
            publicKey: vaultData.keys?.ecdsa || '0x' + Array(64).fill('0').join(''),
            name: 'Imported Device'
          }
        ],
        keys: vaultData.keys || {
          ecdsa: '0x' + Array(64).fill('0').join(''),
          eddsa: '0x' + Array(64).fill('0').join(''),
          hexChainCode: Array(64).fill('0').join(''),
          hexEncryptionKey: Array(64).fill('0').join('')
        }
      }

      const vault = new Vault(summary)
      
      // Apply global configuration (merge chains, set currency)
      this.applyConfig(vault)
      
      // Store vault
      this.vaultStorage.set(summary.id, vault)

      return vault

    } catch (error) {
      throw new Error(`Failed to import vault: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  static async load(vault: Vault, password?: string): Promise<void> {
    // Mock password validation
    if (vault.summary().isEncrypted && !password) {
      throw new Error('Password required for encrypted vault')
    }

    // Set as active vault
    this.activeVault = vault
    
    // Apply current global configuration
    this.applyConfig(vault)
  }

  static async list(): Promise<Summary[]> {
    return Array.from(this.vaultStorage.values()).map(vault => vault.summary())
  }

  static async remove(vault: Vault): Promise<void> {
    const id = vault.summary().id
    this.vaultStorage.delete(id)
    
    if (this.activeVault?.summary().id === id) {
      this.activeVault = null
    }
  }

  static async clear(): Promise<void> {
    this.vaultStorage.clear()
    this.activeVault = null
  }

  // === ACTIVE VAULT MANAGEMENT ===
  static setActive(vault: Vault): void {
    this.activeVault = vault
  }

  static getActive(): Vault | null {
    return this.activeVault
  }

  static hasActive(): boolean {
    return this.activeVault !== null
  }

  // === GLOBAL CONFIGURATION ===
  static async setDefaultChains(chains: string[]): Promise<void> {
    this.config.defaultChains = [...chains]
    
    // Apply to all existing vaults
    for (const vault of this.vaultStorage.values()) {
      // Merge new chains with existing ones (union)
      const existingChains = vault.chains()
      const mergedChains = [...new Set([...existingChains, ...chains])]
      vault.setChains(mergedChains)
    }
  }

  static getDefaultChains(): string[] {
    return [...this.config.defaultChains]
  }

  static async setDefaultCurrency(currency: string): Promise<void> {
    this.config.defaultCurrency = currency
    
    // Apply to all existing vaults
    for (const vault of this.vaultStorage.values()) {
      await vault.setCurrency(currency)
    }
  }

  static getDefaultCurrency(): string {
    return this.config.defaultCurrency
  }

  static async saveConfig(config: Partial<VaultManagerConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
  }

  static getConfig(): VaultManagerConfig {
    return { ...this.config }
  }

  // === ADDRESS BOOK (GLOBAL) ===
  static async addressBook(chain?: string): Promise<AddressBook> {
    const saved = this.addressBookStorage.filter(entry => 
      entry.source === 'saved' && (!chain || entry.chain === chain)
    )

    const vaultAddresses: AddressBookEntry[] = []
    
    // Get addresses from all vaults
    for (const vault of this.vaultStorage.values()) {
      const summary = vault.summary()
      const chains = chain ? [chain] : summary.chains
      
      for (const chainId of chains) {
        try {
          const address = await vault.address(chainId)
          vaultAddresses.push({
            chain: chainId,
            address,
            name: `${summary.name} (${chainId})`,
            source: 'vault',
            vaultId: summary.id,
            vaultName: summary.name,
            dateAdded: summary.createdAt
          })
        } catch {
          // Skip if address derivation fails
        }
      }
    }

    return {
      saved,
      vaults: vaultAddresses
    }
  }

  static async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    for (const entry of entries) {
      const exists = this.addressBookStorage.some(e => 
        e.chain === entry.chain && e.address === entry.address
      )
      
      if (!exists) {
        this.addressBookStorage.push({
          ...entry,
          source: 'saved',
          dateAdded: Date.now()
        })
      }
    }
  }

  static async removeAddressBookEntry(addresses: Array<{chain: string, address: string}>): Promise<void> {
    for (const { chain, address } of addresses) {
      this.addressBookStorage = this.addressBookStorage.filter(entry =>
        !(entry.chain === chain && entry.address === address && entry.source === 'saved')
      )
    }
  }

  static async updateAddressBookEntry(chain: string, address: string, name: string): Promise<void> {
    const entry = this.addressBookStorage.find(e =>
      e.chain === chain && e.address === address && e.source === 'saved'
    )
    
    if (entry) {
      entry.name = name
    }
  }

  // === VAULT SETTINGS INHERITANCE ===
  private static applyConfig(vault: Vault): Vault {
    // Merge global chains with vault chains (union)
    const vaultChains = vault.chains()
    const mergedChains = [...new Set([...vaultChains, ...this.config.defaultChains])]
    vault.setChains(mergedChains)
    
    // Set global currency
    vault.setCurrency(this.config.defaultCurrency)
    
    return vault
  }

  // === HELPER METHODS ===
  private static createMockSigners(totalSigners: number, myIndex: number): VaultSigner[] {
    const signers: VaultSigner[] = []
    
    for (let i = 0; i < totalSigners; i++) {
      signers.push({
        id: `signer-${i + 1}`,
        publicKey: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        name: i === myIndex ? 'This Device' : (i === 0 && totalSigners === 2 ? 'VultiServer' : `Device ${i + 1}`)
      })
    }
    
    return signers
  }
}
