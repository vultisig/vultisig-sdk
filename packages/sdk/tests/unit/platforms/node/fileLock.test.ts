import { describe, expect, it, vi } from 'vitest'

const { load } = vi.hoisted(() => ({
  load: vi.fn(() => {
    throw new Error('native libraries are unavailable')
  }),
}))

vi.mock('koffi', () => ({
  default: { load },
}))

describe('native file lock loading', () => {
  it('does not load native libraries when the Node storage module is imported', async () => {
    await expect(import('../../../../src/platforms/node/storage')).resolves.toBeDefined()
    expect(load).not.toHaveBeenCalled()
  })
})
