import AsyncStorage from '@react-native-async-storage/async-storage'

import type { Storage, StorageMetadata, StoredValue } from '../../storage/types'
import { STORAGE_VERSION, StorageError, StorageErrorCode } from '../../storage/types'

const KEY_PREFIX = 'vultisig:'

function prefixed(key: string): string {
  return `${KEY_PREFIX}${key}`
}

export class ReactNativeStorage implements Storage {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(prefixed(key))
      if (raw === null) return null
      const stored = JSON.parse(raw) as StoredValue<T>
      return stored.value
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to get "${key}"`, error as Error)
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      lastModified: Date.now(),
    }
    const stored: StoredValue<T> = { value, metadata }
    try {
      await AsyncStorage.setItem(prefixed(key), JSON.stringify(stored))
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to set "${key}"`, error as Error)
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(prefixed(key))
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to remove "${key}"`, error as Error)
    }
  }

  async list(): Promise<string[]> {
    try {
      const allKeys = await AsyncStorage.getAllKeys()
      return allKeys.filter(k => k.startsWith(KEY_PREFIX)).map(k => k.slice(KEY_PREFIX.length))
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to list keys', error as Error)
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.list()
      await AsyncStorage.removeMany(keys.map(prefixed))
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to clear storage', error as Error)
    }
  }
}
