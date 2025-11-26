/**
 * React Native storage implementation
 * Uses AsyncStorage for persistent storage
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  Storage,
  StorageMetadata,
  StoredValue,
} from "../../storage/types";
import {
  STORAGE_VERSION,
  StorageError,
  StorageErrorCode,
} from "../../storage/types";

export class ReactNativeStorage implements Storage {
  async get<T>(key: string): Promise<T | null> {
    try {
      const stored = await AsyncStorage.getItem(key);
      if (!stored) return null;

      const parsed = JSON.parse(stored) as StoredValue<T>;
      return parsed.value;
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to get value for key "${key}"`,
        error as Error,
      );
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      lastModified: Date.now(),
    };

    const stored: StoredValue<T> = { value, metadata };

    try {
      await AsyncStorage.setItem(key, JSON.stringify(stored));
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to set value for key "${key}"`,
        error as Error,
      );
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to remove key "${key}"`,
        error as Error,
      );
    }
  }

  async list(): Promise<string[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return keys ? [...keys] : [];
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        "Failed to list keys",
        error as Error,
      );
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.list();
      await AsyncStorage.multiRemove(keys);
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        "Failed to clear storage",
        error as Error,
      );
    }
  }

  async getUsage(): Promise<number> {
    // AsyncStorage doesn't provide usage info
    // Estimate by summing all values
    try {
      const keys = await this.list();
      let size = 0;
      for (const key of keys) {
        const value = await this.get(key);
        size += key.length * 2; // UTF-16
        size += JSON.stringify(value).length * 2;
      }
      return size;
    } catch {
      return 0;
    }
  }

  async getQuota(): Promise<number | undefined> {
    // AsyncStorage doesn't provide quota info
    return undefined;
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    try {
      const stored = await AsyncStorage.getItem(key);
      if (!stored) return null;

      const parsed = JSON.parse(stored) as StoredValue;
      return parsed.metadata;
    } catch {
      return null;
    }
  }
}
