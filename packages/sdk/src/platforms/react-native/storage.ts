import AsyncStorage from '@react-native-async-storage/async-storage'

import type {
  Storage,
  StorageMetadata,
  StoredValue,
} from '../../storage/types'
import { STORAGE_VERSION } from '../../storage/types'

const KEY_PREFIX = 'vultisig:'

function prefixKey(key: string): string {
  return `${KEY_PREFIX}${key}`
}

function createMetadata(): StorageMetadata {
  return {
    version: STORAGE_VERSION,
    createdAt: Date.now(),
    lastModified: Date.now(),
  }
}

export class ReactNativeStorage implements Storage {
  async get<T>(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(prefixKey(key))
    if (raw === null) return null
    const stored: StoredValue<T> = JSON.parse(raw)
    return stored.value
  }

  async set<T>(key: string, value: T): Promise<void> {
    const stored: StoredValue<T> = {
      value,
      metadata: createMetadata(),
    }
    await AsyncStorage.setItem(prefixKey(key), JSON.stringify(stored))
  }

  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(prefixKey(key))
  }

  async list(): Promise<string[]> {
    const allKeys = await AsyncStorage.getAllKeys()
    return allKeys
      .filter(k => k.startsWith(KEY_PREFIX))
      .map(k => k.slice(KEY_PREFIX.length))
  }

  async clear(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys()
    const vultisigKeys = keys.filter(k => k.startsWith(KEY_PREFIX))
    if (vultisigKeys.length > 0) {
      await AsyncStorage.multiRemove(vultisigKeys)
    }
  }
}
