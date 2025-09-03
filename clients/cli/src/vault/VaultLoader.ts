import * as fs from 'fs'
import { VaultManager } from 'vultisig-sdk'
import type { Vault } from 'vultisig-sdk'

// Legacy interface for backward compatibility
export interface VaultData {
  name: string
  publicKeyEcdsa: string
  publicKeyEddsa: string
  signers: string[]
  createdAt?: Date
  hexChainCode: string
  keyShares: KeyShareData[]
  localPartyId: string
  resharePrefix?: string
  libType: number // 0 = GG20, 1 = DKLS
}

export interface KeyShareData {
  publicKey: string
  keyshare: string
}

export interface VaultContainer {
  version?: bigint
  vault: string
  isEncrypted: boolean
}

export class VaultLoader {
  private vaultManager: VaultManager
  
  constructor() {
    this.vaultManager = new VaultManager()
  }
  
  async loadVaultFromFile(filePath: string, password?: string): Promise<VaultData> {
    try {
      // Use SDK VaultManager to load the vault
      const buffer = await fs.promises.readFile(filePath)
      const file = new File([buffer], filePath.split('/').pop() || 'vault.vult')
      const vault = await this.vaultManager.importVaultFromFile(file, password)
      
      // Convert SDK Vault to legacy VaultData format for backward compatibility
      return this.vaultToVaultData(vault)
    } catch (error) {
      throw new Error(`Failed to load vault from file: ${error instanceof Error ? error.message : error}`)
    }
  }
  
  async loadVaultFromString(content: string, password?: string): Promise<VaultData> {
    try {
      // Create a temporary file-like object from string content
      const buffer = Buffer.from(content, 'utf8')
      const file = new File([buffer], 'vault.vult')
      const vault = await this.vaultManager.importVaultFromFile(file, password)
      
      // Convert SDK Vault to legacy VaultData format
      return this.vaultToVaultData(vault)
    } catch (error) {
      throw new Error(`Failed to load vault from string: ${error instanceof Error ? error.message : error}`)
    }
  }
  
  async checkIfUnencrypted(filePath: string): Promise<boolean> {
    try {
      const buffer = await fs.promises.readFile(filePath)
      const file = new File([buffer], filePath.split('/').pop() || 'vault.vult')
      return !(await this.vaultManager.isVaultFileEncrypted(file))
    } catch {
      return false
    }
  }
  
  // Helper method to check if a vault file exists and is readable
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK | fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  }
  
  // Helper method to get vault info without fully parsing it
  async getVaultInfo(filePath: string): Promise<{ name: string; isEncrypted: boolean; signers: string[] }> {
    try {
      const buffer = await fs.promises.readFile(filePath)
      const file = new File([buffer], filePath.split('/').pop() || 'vault.vult')
      const isEncrypted = await this.vaultManager.isVaultFileEncrypted(file)
      
      if (isEncrypted) {
        return {
          name: 'Encrypted Vault',
          isEncrypted: true,
          signers: []
        }
      }
      
      // Try to load vault to get info
      try {
        const vault = await this.vaultManager.importVaultFromFile(file)
        return {
          name: vault.name,
          isEncrypted: false,
          signers: vault.signers
        }
      } catch {
        return {
          name: 'Unknown',
          isEncrypted,
          signers: []
        }
      }
    } catch {
      return {
        name: 'Unknown',
        isEncrypted: false,
        signers: []
      }
    }
  }
  
  // Convert SDK Vault to legacy VaultData format for backward compatibility
  private vaultToVaultData(vault: Vault): VaultData {
    // Extract keyshares - handle both encrypted and unencrypted formats
    const keyShares: KeyShareData[] = []
    
    if (vault.keyShares && typeof vault.keyShares === 'object') {
      // Handle object format keyshares
      const keySharesObj = vault.keyShares as any
      if (keySharesObj.ecdsa) {
        keyShares.push({
          publicKey: vault.publicKeys.ecdsa,
          keyshare: keySharesObj.ecdsa
        })
      }
      if (keySharesObj.eddsa) {
        keyShares.push({
          publicKey: vault.publicKeys.eddsa,
          keyshare: keySharesObj.eddsa
        })
      }
    }
    
    return {
      name: vault.name,
      publicKeyEcdsa: vault.publicKeys.ecdsa,
      publicKeyEddsa: vault.publicKeys.eddsa,
      signers: vault.signers,
      createdAt: vault.createdAt ? new Date(vault.createdAt) : undefined,
      hexChainCode: vault.hexChainCode,
      keyShares,
      localPartyId: vault.localPartyId,
      resharePrefix: (vault as any).resharePrefix,
      libType: vault.libType === 'DKLS' ? 1 : 0 // Convert string to number
    }
  }
}