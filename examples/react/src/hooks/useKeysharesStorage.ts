import { toBinary } from '@bufbuild/protobuf'
import { toCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { base64Encode } from '@lib/utils/base64Encode'
import { encryptWithAesGcm } from '@lib/utils/encryption/aesGcm/encryptWithAesGcm'
import { useCallback, useEffect, useState } from 'react'

import type { LoadedKeyshare } from '../types'

export type StoredKeyshare = {
  id: string
  name: string
  size?: number
  encrypted: boolean | null
  dateAdded: number
  // Optional embedded content encoded as base64 .vult container for direct load
  containerBase64?: string
}

const STORAGE_KEY = 'vultisig_keyshares'

const readAll = (): StoredKeyshare[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredKeyshare[]) : []
  } catch {
    return []
  }
}

const writeAll = (items: StoredKeyshare[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

const addStoredKeyshare = (input: {
  name: string
  size?: number
  encrypted: boolean | null
}): StoredKeyshare | null => {
  const current = readAll()
  const item: StoredKeyshare = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: input.name,
    size: input.size,
    encrypted: input.encrypted,
    dateAdded: Date.now(),
  }
  writeAll([item, ...current])
  return item
}

const removeStoredKeyshare = (id: string): boolean => {
  const current = readAll()
  const next = current.filter(k => k.id !== id)
  writeAll(next)
  return next.length !== current.length
}

const clearStoredKeyshares = (): boolean => {
  writeAll([])
  return true
}

const getStoredKeyshares = (): StoredKeyshare[] => readAll()

const getStorageInfo = () => {
  const items = readAll()
  const approxBytes = new Blob([JSON.stringify(items)]).size
  const kb = Math.round(approxBytes / 1024)
  return {
    available: true,
    keyshareCount: items.length,
    estimatedSize: `${kb} KB`,
  }
}

export type UseKeysharesStorageReturn = {
  // State
  storedKeyshares: StoredKeyshare[]
  loading: boolean
  error: string | null

  // Actions
  saveKeyshare: (keyshare: LoadedKeyshare) => Promise<StoredKeyshare | null>
  saveVaultToStorage: (
    vault: any,
    options?: { name?: string; password?: string }
  ) => Promise<StoredKeyshare | null>
  removeKeyshare: (keyshareId: string) => Promise<boolean>
  clearAllKeyshares: () => Promise<boolean>
  refreshKeyshares: () => void
  getStoredKeyshareById: (id: string) => StoredKeyshare | undefined

  // Storage info
  storageInfo: {
    available: boolean
    keyshareCount: number
    estimatedSize: string
  }
}

/**
 * React hook for managing keyshares in browser storage
 */
export function useKeysharesStorage(): UseKeysharesStorageReturn {
  const [storedKeyshares, setStoredKeyshares] = useState<StoredKeyshare[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storageInfo, setStorageInfo] = useState(() => getStorageInfo())

  // Load keyshares from storage
  const loadKeyshares = useCallback(() => {
    try {
      setLoading(true)
      setError(null)

      const keyshares = getStoredKeyshares()
      setStoredKeyshares(keyshares)
      setStorageInfo(getStorageInfo())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Save a keyshare to storage
  const saveKeyshare = useCallback(
    async (keyshare: LoadedKeyshare): Promise<StoredKeyshare | null> => {
      try {
        setError(null)

        const storedKeyshare = addStoredKeyshare({
          name: keyshare.name,
          size: keyshare.size,
          encrypted: keyshare.encrypted ?? null,
        })

        if (storedKeyshare) {
          // Refresh the list
          loadKeyshares()
          return storedKeyshare
        } else {
          throw new Error('Failed to save keyshare to storage')
        }
      } catch (err) {
        const errorMsg = (err as Error).message
        setError(errorMsg)
        throw new Error(errorMsg)
      }
    },
    [loadKeyshares]
  )

  // Save a live vault object into storage as a .vult container (optionally encrypted)
  const saveVaultToStorage = useCallback(
    async (
      vault: any,
      options?: { name?: string; password?: string }
    ): Promise<StoredKeyshare | null> => {
      try {
        const comm = toCommVault(vault)
        const binary = toBinary(VaultSchema, comm)
        let containerVaultBase64: string
        let encrypted = false
        if (options?.password) {
          const encryptedBytes = await encryptWithAesGcm({
            key: options.password,
            value: Buffer.from(binary),
          })
          containerVaultBase64 = base64Encode(encryptedBytes)
          encrypted = true
        } else {
          containerVaultBase64 = base64Encode(binary)
          encrypted = false
        }
        const item = addStoredKeyshare({
          name: `${options?.name ?? vault.name}.vult`,
          size: containerVaultBase64.length,
          encrypted,
        })
        if (!item) throw new Error('Failed to save vault to storage')
        // attach payload
        const cur = readAll()
        const withPayload = cur.map(k =>
          k.id === item.id ? { ...k, containerBase64: containerVaultBase64 } : k
        )
        writeAll(withPayload)
        loadKeyshares()
        return { ...item, containerBase64: containerVaultBase64 }
      } catch (err) {
        const errorMsg = (err as Error).message
        setError(errorMsg)
        throw new Error(errorMsg)
      }
    },
    [loadKeyshares]
  )

  // Remove a keyshare from storage
  const removeKeyshare = useCallback(
    async (keyshareId: string): Promise<boolean> => {
      try {
        setError(null)

        const success = removeStoredKeyshare(keyshareId)

        if (success) {
          // Refresh the list
          loadKeyshares()
          return true
        } else {
          throw new Error('Failed to remove keyshare from storage')
        }
      } catch (err) {
        const errorMsg = (err as Error).message
        setError(errorMsg)
        return false
      }
    },
    [loadKeyshares]
  )

  // Clear all keyshares
  const clearAllKeyshares = useCallback(async (): Promise<boolean> => {
    try {
      setError(null)

      const success = clearStoredKeyshares()

      if (success) {
        // Refresh the list
        loadKeyshares()
        return true
      } else {
        throw new Error('Failed to clear keyshares from storage')
      }
    } catch (err) {
      const errorMsg = (err as Error).message
      setError(errorMsg)
      return false
    }
  }, [loadKeyshares])

  // Refresh keyshares list
  const refreshKeyshares = useCallback(() => {
    loadKeyshares()
  }, [loadKeyshares])

  const getStoredKeyshareById = useCallback(
    (id: string) => readAll().find(k => k.id === id),
    []
  )

  // Load keyshares on mount
  useEffect(() => {
    loadKeyshares()
  }, [loadKeyshares])

  // Listen for storage changes (in case multiple tabs are open)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('vultisig_keyshares')) {
        loadKeyshares()
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [loadKeyshares])

  return {
    storedKeyshares,
    loading,
    error,
    saveKeyshare,
    saveVaultToStorage,
    removeKeyshare,
    clearAllKeyshares,
    refreshKeyshares,
    getStoredKeyshareById,
    storageInfo,
  }
}
