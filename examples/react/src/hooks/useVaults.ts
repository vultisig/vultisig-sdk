import { useCallback, useEffect, useState } from 'react'
import { Vultisig, type Summary, type StoredVault } from 'vultisig-sdk'

export type UseVaultsReturn = {
  vaults: Summary[]
  loading: boolean
  error: string | null
  refreshVaults: () => Promise<void>
  clearAllVaults: () => Promise<void>
  getVaultData: (vaultId: string) => Promise<StoredVault | null>
  getStorageInfo: () => {
    available: boolean
    vaultCount: number
    estimatedSize: string
  }
}

export function useVaults(sdk: Vultisig): UseVaultsReturn {
  const [vaults, setVaults] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshVaults = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const vaultList = await sdk.listVaults()
      setVaults(vaultList)
    } catch (err) {
      setError((err as Error).message)
      console.error('Failed to load vaults:', err)
    } finally {
      setLoading(false)
    }
  }, [sdk])

  const clearAllVaults = useCallback(async () => {
    try {
      await sdk.clearVaults()
      await refreshVaults()
    } catch (err) {
      setError((err as Error).message)
      console.error('Failed to clear vaults:', err)
    }
  }, [sdk, refreshVaults])

  const getVaultData = useCallback(
    async (vaultId: string): Promise<StoredVault | null> => {
      try {
        const storageManager = sdk.getVaultManagement().getStorageManager()
        return await storageManager.getVault(vaultId)
      } catch (err) {
        console.error('Failed to get vault data:', err)
        return null
      }
    },
    [sdk]
  )

  const getStorageInfo = useCallback(() => {
    const totalBytes = vaults.reduce((sum, vault) => sum + (vault.size || 0), 0)
    const sizeKB = Math.round(totalBytes / 1024)
    return {
      available: true,
      vaultCount: vaults.length,
      estimatedSize: `${sizeKB} KB`,
    }
  }, [vaults])

  useEffect(() => {
    refreshVaults()
  }, [refreshVaults])

  return {
    vaults,
    loading,
    error,
    refreshVaults,
    clearAllVaults,
    getVaultData,
    getStorageInfo,
  }
}

