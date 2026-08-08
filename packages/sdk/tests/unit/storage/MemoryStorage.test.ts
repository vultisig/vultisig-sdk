import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryStorage } from '../../../src/storage/MemoryStorage'

describe('MemoryStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clones stored values when structuredClone is unavailable', async () => {
    vi.stubGlobal('structuredClone', undefined)
    const storage = new MemoryStorage()
    const original = { nested: { value: 'initial' } }

    await storage.set('value', original)
    original.nested.value = 'mutated after set'

    const firstRead = await storage.get<typeof original>('value')
    expect(firstRead).toEqual({ nested: { value: 'initial' } })

    firstRead!.nested.value = 'mutated after get'
    await expect(storage.get('value')).resolves.toEqual({ nested: { value: 'initial' } })
  })

  it('applies conditional writes synchronously before yielding', async () => {
    const storage = new MemoryStorage()
    const results = await Promise.all([
      storage.compareAndSet('vault', null, { owner: 'first' }),
      storage.compareAndSet('vault', null, { owner: 'second' }),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    await expect(storage.get('vault')).resolves.toEqual(results[0] ? { owner: 'first' } : { owner: 'second' })
  })
})
