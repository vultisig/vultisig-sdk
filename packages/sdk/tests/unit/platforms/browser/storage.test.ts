import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserStorage } from '../../../../src/platforms/browser/storage'
import { StorageError, StorageErrorCode } from '../../../../src/storage/types'

class LocalStorageDouble implements Storage {
  private readonly values = new Map<string, string>()
  failReads = false
  failWrites = false
  failMarkerWrites = false

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    if (this.failReads) {
      throw new DOMException('storage unavailable', 'SecurityError')
    }
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    if (this.failReads) {
      throw new DOMException('storage unavailable', 'SecurityError')
    }
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (this.failWrites || (this.failMarkerWrites && key === '__vultisig_storage_backend__')) {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
    this.values.set(key, value)
  }
}

const stored = (value: unknown) =>
  JSON.stringify({
    value,
    metadata: { version: 1, createdAt: 1, lastModified: 1 },
  })

describe('BrowserStorage backend selection', () => {
  let local: LocalStorageDouble

  beforeEach(() => {
    local = new LocalStorageDouble()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shares one IndexedDB initialization across concurrent operations', async () => {
    const open = vi.spyOn(indexedDB, 'open')
    const storage = new BrowserStorage()

    await Promise.all([storage.get('missing'), storage.list(), storage.getQuota()])

    expect(open).toHaveBeenCalledTimes(1)
    expect(local.getItem('__vultisig_storage_backend__')).toBe('indexeddb')
  })

  it('surfaces IndexedDB quota without switching to localStorage or hiding existing keys', async () => {
    const storage = new BrowserStorage()
    await storage.set('vault:existing', { name: 'existing' })
    const database = (storage as any).db as IDBDatabase
    const quotaError = new DOMException('quota exceeded', 'QuotaExceededError')
    vi.spyOn(database, 'transaction').mockImplementationOnce(() => {
      const transaction = {
        error: null,
        objectStore: () => ({
          put: () => queueMicrotask(() => transaction.onerror?.({ target: { error: quotaError } } as unknown as Event)),
        }),
        onabort: null,
        oncomplete: null,
        onerror: null,
      } as unknown as IDBTransaction
      return transaction
    })

    await expect(storage.set('vault:new', { name: 'new' })).rejects.toMatchObject({
      code: StorageErrorCode.QuotaExceeded,
    })
    await expect(storage.get('vault:existing')).resolves.toEqual({
      name: 'existing',
    })
    await expect(storage.get('vault:new')).resolves.toBeNull()
    expect(local.getItem('vault:new')).toBeNull()
    expect(local.getItem('__vultisig_storage_backend__')).toBe('indexeddb')
  })

  it('fails closed after an IndexedDB version change instead of switching to localStorage', async () => {
    const storage = new BrowserStorage()
    await storage.set('vault:indexeddb', { name: 'indexeddb' })
    local.setItem('vault:fallback-only', stored({ name: 'fallback' }))
    const database = (storage as any).db as IDBDatabase

    database.onversionchange?.({} as IDBVersionChangeEvent)

    expect((storage as any).db).toBeUndefined()
    await expect(storage.get('vault:fallback-only')).rejects.toMatchObject({
      code: StorageErrorCode.StorageUnavailable,
    })
    expect(local.getItem('__vultisig_storage_backend__')).toBe('indexeddb')
  })

  it('uses localStorage only when IndexedDB is absent and keeps that choice across reloads', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const first = new BrowserStorage()
    await first.set('vault:local', { name: 'local' })

    const availableIndexedDB = new IDBFactory()
    const open = vi.spyOn(availableIndexedDB, 'open')
    vi.stubGlobal('indexedDB', availableIndexedDB)
    const reloaded = new BrowserStorage()

    await expect(reloaded.get('vault:local')).resolves.toEqual({
      name: 'local',
    })
    expect(open).not.toHaveBeenCalled()
    expect(local.getItem('__vultisig_storage_backend__')).toBe('localstorage')
  })

  it('recovers an unmarked legacy localStorage vault set when IndexedDB is empty', async () => {
    local.setItem('vault:legacy', stored({ name: 'legacy' }))
    const storage = new BrowserStorage()

    await expect(storage.get('vault:legacy')).resolves.toEqual({ name: 'legacy' })
    expect(local.getItem('__vultisig_storage_backend__')).toBe('localstorage')
  })

  it('recovers an unmarked legacy record with an arbitrary public storage key', async () => {
    local.setItem('custom', stored({ name: 'legacy' }))
    const storage = new BrowserStorage()

    await expect(storage.get('custom')).resolves.toEqual({ name: 'legacy' })
    expect(local.getItem('__vultisig_storage_backend__')).toBe('localstorage')
  })

  it('fails closed while legacy localStorage is unreadable and recovers it on reload', async () => {
    local.setItem('vault:legacy', stored({ name: 'legacy' }))
    local.failReads = true
    const degraded = new BrowserStorage()

    await expect(degraded.list()).rejects.toMatchObject({
      code: StorageErrorCode.StorageUnavailable,
    })

    local.failReads = false
    const recovered = new BrowserStorage()
    await expect(recovered.get('vault:legacy')).resolves.toEqual({ name: 'legacy' })
    expect(local.getItem('__vultisig_storage_backend__')).toBe('localstorage')
  })

  it('surfaces unmarked cross-backend divergence instead of exposing either partial set', async () => {
    const canonical = new BrowserStorage()
    await canonical.set('vault:indexeddb', { name: 'indexeddb' })
    local.removeItem('__vultisig_storage_backend__')
    local.setItem('vault:local', stored({ name: 'local' }))

    const divergent = new BrowserStorage()
    await expect(divergent.list()).rejects.toMatchObject({
      code: StorageErrorCode.StorageUnavailable,
    })
  })

  it('surfaces localStorage quota without switching to an empty memory store', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const storage = new BrowserStorage()
    await storage.set('vault:existing', { name: 'existing' })
    local.failWrites = true

    await expect(storage.set('vault:new', { name: 'new' })).rejects.toMatchObject({
      code: StorageErrorCode.QuotaExceeded,
    })
    await expect(storage.get('vault:existing')).resolves.toEqual({
      name: 'existing',
    })
    await expect(storage.get('vault:new')).resolves.toBeNull()
  })

  it('retries localStorage selection on the same instance after marker persistence fails', async () => {
    vi.stubGlobal('indexedDB', undefined)
    local.failMarkerWrites = true
    const storage = new BrowserStorage()

    await expect(storage.list()).rejects.toMatchObject({
      code: StorageErrorCode.StorageUnavailable,
    })

    local.failMarkerWrites = false
    await storage.set('custom', { name: 'recovered' })
    await expect(storage.get('custom')).resolves.toEqual({ name: 'recovered' })
    expect(local.getItem('__vultisig_storage_backend__')).toBe('localstorage')
  })

  it('fails closed when IndexedDB is blocked instead of exposing a partial localStorage view', async () => {
    local.setItem('vault:fallback-only', stored({ name: 'fallback' }))
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: Record<string, unknown> = {}
        queueMicrotask(() => (request.onblocked as (() => void) | undefined)?.())
        return request
      },
    })
    const storage = new BrowserStorage()

    await expect(storage.list()).rejects.toMatchObject({
      code: StorageErrorCode.StorageUnavailable,
    })
    expect(local.getItem('vault:fallback-only')).not.toBeNull()
  })

  it('retries a persisted IndexedDB store on the same instance after a transient open failure', async () => {
    local.setItem('__vultisig_storage_backend__', 'indexeddb')
    local.setItem('vault:partial-fallback', stored({ name: 'partial' }))
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: Record<string, unknown> = {
          error: new DOMException('open failed', 'UnknownError'),
        }
        queueMicrotask(() => (request.onerror as (() => void) | undefined)?.())
        return request
      },
    })
    const storage = new BrowserStorage()

    await expect(storage.get('vault:partial-fallback')).rejects.toMatchObject({
      code: StorageErrorCode.StorageUnavailable,
    })

    vi.stubGlobal('indexedDB', new IDBFactory())
    await storage.set('vault:canonical', { name: 'canonical' })
    await expect(storage.get('vault:canonical')).resolves.toEqual({
      name: 'canonical',
    })
    await expect(storage.get('vault:partial-fallback')).resolves.toBeNull()
  })

  it('surfaces malformed localStorage records as typed serialization failures', async () => {
    vi.stubGlobal('indexedDB', undefined)
    local.setItem('__vultisig_storage_backend__', 'localstorage')
    local.setItem('vault:corrupt', '{')
    const storage = new BrowserStorage()

    await expect(storage.get('vault:corrupt')).rejects.toBeInstanceOf(StorageError)
    await expect(storage.get('vault:corrupt')).rejects.toMatchObject({
      code: StorageErrorCode.SerializationFailed,
    })
  })
})
