import type {
  KeygenMode,
  VaultCreationStep,
  VaultType,
  Vault,
} from '../types'

export type VaultCreateOptions = {
  type?: VaultType
  keygenMode?: KeygenMode
  password?: string
  email?: string
  onProgress?: (step: VaultCreationStep) => void
}

export type VaultCreateInput = {
  name: string
  options?: VaultCreateOptions
  sdkInstance?: any
  config: {
    defaultChains: string[]
    defaultCurrency: string
  }
}

/**
 * VaultCreate handles the creation of new vaults
 * Extracted from VaultManager to follow single responsibility principle
 */
export class VaultCreate {
  /**
   * Create new vault with the specified options
   */
  static async create({
    name,
    options,
    sdkInstance,
    config,
  }: VaultCreateInput): Promise<Vault> {
    // Validate required parameters
    if (!name || name.trim().length === 0) {
      throw new Error('Vault name is required')
    }

    // Set defaults
    const vaultType = options?.type || 'fast'
    const keygenMode = options?.keygenMode || 'fast'
    const password = options?.password
    const email = options?.email
    const onProgress = options?.onProgress

    // Only fast vaults are supported for now
    if (vaultType !== 'fast') {
      throw new Error('Only fast vault creation is currently supported')
    }

    // Validate required parameters for fast vault
    if (!password) {
      throw new Error('Password is required for fast vault creation')
    }
    if (!email) {
      throw new Error('Email is required for fast vault creation')
    }

    try {
      // Import ServerManager dynamically to avoid circular dependencies
      const { ServerManager } = await import('../server/ServerManager')
      
      // Create ServerManager instance
      const serverManager = new ServerManager()

      // Progress callback wrapper
      const progressWrapper = (update: any) => {
        try {
          // Convert KeygenProgressUpdate to VaultCreationStep
          let step: VaultCreationStep
          if (update.phase === 'prepare') {
            step = {
              step: 'initializing',
              progress: 10,
              message: 'Preparing vault creation...'
            }
          } else if (update.phase === 'ecdsa') {
            step = {
              step: 'keygen',
              progress: 30 + (update.round || 0) * 5,
              message: `Generating ECDSA keys (round ${update.round || 0})...`
            }
          } else if (update.phase === 'eddsa') {
            step = {
              step: 'keygen',
              progress: 60 + (update.round || 0) * 3,
              message: `Generating EdDSA keys (round ${update.round || 0})...`
            }
          } else if (update.phase === 'complete') {
            step = {
              step: 'complete',
              progress: 100,
              message: 'Vault creation complete'
            }
          } else {
            step = {
              step: 'keygen',
              progress: 50,
              message: 'Generating keys...'
            }
          }
          onProgress?.(step)
        } catch (error) {
          console.warn('Progress callback error:', error)
        }
      }

      // Create fast vault using ServerManager
      onProgress?.({
        step: 'initializing',
        progress: 5,
        message: 'Starting vault creation...'
      })
      
      const result = await serverManager.createFastVault({
        name: name.trim(),
        email,
        password,
        onLog: (msg: string) => {
          console.log(`[VaultCreate] ${msg}`)
        },
        onProgress: progressWrapper
      })

      onProgress?.({
        step: 'complete',
        progress: 100,
        message: 'Vault created successfully'
      })

      return result.vault
    } catch (error) {
      console.error('Vault creation failed:', error)
      
      // Re-throw with more context
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to create vault: ${errorMessage}`)
    }
  }

}
