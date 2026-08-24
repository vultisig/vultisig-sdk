import AsyncStorage from '@react-native-async-storage/async-storage'
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite'

import { storageValuesEqual } from '../../storage/storageValuesEqual'
import type { Storage, StorageMetadata, StoredValue } from '../../storage/types'
import { STORAGE_VERSION, StorageError, StorageErrorCode } from '../../storage/types'

const KEY_PREFIX = 'vultisig:'
const DATABASE_NAME = 'vultisig-sdk-storage.db'
const LEGACY_COPY_MIGRATION = 'async-storage-v1-copied'
const LEGACY_CLEANUP_MIGRATION = 'async-storage-v1-cleaned'
const LOCK_WAIT_MS = 30_000
let databasePromise: Promise<SQLiteDatabase> | undefined

type StoredRow = { payload: string }
type KeyRow = { key: string }
type MigrationRow = { name: string }

async function initializeDatabase(database: SQLiteDatabase): Promise<void> {
  let cleanupRequired = false

  await database.withExclusiveTransactionAsync(async transaction => {
    await transaction.execAsync(`
      PRAGMA busy_timeout = ${LOCK_WAIT_MS};
      CREATE TABLE IF NOT EXISTS storage_values (
        key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS storage_mutation_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS storage_migrations (
        name TEXT PRIMARY KEY NOT NULL
      );
      INSERT OR IGNORE INTO storage_mutation_lock (id, revision) VALUES (1, 0);
      UPDATE storage_mutation_lock
      SET revision = CASE WHEN revision >= 2147483647 THEN 0 ELSE revision + 1 END
      WHERE id = 1;
    `)

    const cleanupComplete = await transaction.getFirstAsync<MigrationRow>(
      'SELECT name FROM storage_migrations WHERE name = ?',
      LEGACY_CLEANUP_MIGRATION
    )
    if (cleanupComplete) return

    cleanupRequired = true
    const copyComplete = await transaction.getFirstAsync<MigrationRow>(
      'SELECT name FROM storage_migrations WHERE name = ?',
      LEGACY_COPY_MIGRATION
    )
    if (copyComplete) return

    // Preserve every pre-existing AsyncStorage record byte-for-byte. Invalid
    // JSON remains invalid and will still fail closed when read; the migration
    // itself never silently drops a vault that a previous SDK persisted.
    const legacyKeys = await AsyncStorage.getAllKeys()
    for (const legacyKey of legacyKeys) {
      if (!legacyKey.startsWith(KEY_PREFIX)) continue
      const payload = await AsyncStorage.getItem(legacyKey)
      if (payload === null) continue
      await transaction.runAsync(
        'INSERT OR IGNORE INTO storage_values (key, payload) VALUES (?, ?)',
        legacyKey.slice(KEY_PREFIX.length),
        payload
      )
    }
    await transaction.runAsync('INSERT INTO storage_migrations (name) VALUES (?)', LEGACY_COPY_MIGRATION)
  })

  if (!cleanupRequired) return

  // Cleanup happens only after the SQLite copy commits. If cleanup is
  // interrupted, the durable copy marker makes the next initialization retry
  // only these idempotent removals before exposing the database.
  const remainingLegacyKeys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(KEY_PREFIX))
  for (const legacyKey of remainingLegacyKeys) {
    await AsyncStorage.removeItem(legacyKey)
  }

  await database.withExclusiveTransactionAsync(async transaction => {
    await transaction.execAsync(`
      PRAGMA busy_timeout = ${LOCK_WAIT_MS};
      UPDATE storage_mutation_lock
      SET revision = CASE WHEN revision >= 2147483647 THEN 0 ELSE revision + 1 END
      WHERE id = 1;
    `)
    await transaction.runAsync('INSERT OR IGNORE INTO storage_migrations (name) VALUES (?)', LEGACY_CLEANUP_MIGRATION)
  })
}

async function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME)
      .then(async database => {
        await initializeDatabase(database)
        return database
      })
      .catch(error => {
        databasePromise = undefined
        throw error
      })
  }

  return databasePromise
}

async function withMutationTransaction<T>(operation: (transaction: SQLiteDatabase) => Promise<T>): Promise<T> {
  const database = await getDatabase()
  let result: T | undefined

  await database.withExclusiveTransactionAsync(async transaction => {
    // Expo SQLite starts a deferred transaction. This update obtains the native
    // writer lock before the value is read and held until the value transaction
    // commits, serializing separate React Native JS runtimes. SQLite releases
    // the lock and rolls the value back if a runtime or process dies.
    await transaction.execAsync(`
      PRAGMA busy_timeout = ${LOCK_WAIT_MS};
      UPDATE storage_mutation_lock
      SET revision = CASE WHEN revision >= 2147483647 THEN 0 ELSE revision + 1 END
      WHERE id = 1;
    `)
    result = await operation(transaction)
  })

  return result as T
}

async function readValue<T>(database: SQLiteDatabase, key: string): Promise<T | null> {
  const row = await database.getFirstAsync<StoredRow>('SELECT payload FROM storage_values WHERE key = ?', key)
  if (!row) return null
  const stored = JSON.parse(row.payload) as StoredValue<T>
  return stored.value
}

async function writeValue<T>(database: SQLiteDatabase, key: string, value: T): Promise<void> {
  const metadata: StorageMetadata = {
    version: STORAGE_VERSION,
    createdAt: Date.now(),
    lastModified: Date.now(),
  }
  const stored: StoredValue<T> = { value, metadata }
  await database.runAsync(
    'INSERT OR REPLACE INTO storage_values (key, payload) VALUES (?, ?)',
    key,
    JSON.stringify(stored)
  )
}

/**
 * SQLite-backed React Native storage with one-time AsyncStorage migration.
 * Values and compare-and-set revisions live in the same native transaction,
 * making mutations atomic and crash-recoverable across separate JS runtimes.
 */
export class ReactNativeStorage implements Storage {
  async get<T>(key: string): Promise<T | null> {
    try {
      return await readValue<T>(await getDatabase(), key)
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to get "${key}"`, error as Error)
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await withMutationTransaction(transaction => writeValue(transaction, key, value))
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to set "${key}"`, error as Error)
    }
  }

  async compareAndSet<T>(key: string, expectedValue: T | null, value: T | null): Promise<boolean> {
    try {
      return await withMutationTransaction(async transaction => {
        const currentValue = await readValue<T>(transaction, key)
        if (!storageValuesEqual(currentValue, expectedValue)) {
          return false
        }
        if (value === null) {
          await transaction.runAsync('DELETE FROM storage_values WHERE key = ?', key)
        } else {
          await writeValue(transaction, key, value)
        }
        return true
      })
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, `Failed to conditionally write "${key}"`, error as Error)
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await withMutationTransaction(transaction =>
        transaction.runAsync('DELETE FROM storage_values WHERE key = ?', key)
      )
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to remove "${key}"`, error as Error)
    }
  }

  async list(): Promise<string[]> {
    try {
      const database = await getDatabase()
      const rows = await database.getAllAsync<KeyRow>('SELECT key FROM storage_values')
      return rows.map(({ key }) => key)
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to list keys', error as Error)
    }
  }

  async clear(): Promise<void> {
    try {
      await withMutationTransaction(transaction => transaction.runAsync('DELETE FROM storage_values'))
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to clear storage', error as Error)
    }
  }
}
