import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeSchema } from './schema'

describe('executeSchema', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('waits for stdout to flush before completing', async () => {
    let flush: ((error?: Error | null) => void) | undefined
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((...args: unknown[]) => {
      flush = args.at(-1) as (error?: Error | null) => void
      return false
    }) as typeof process.stdout.write)
    const program = new Command().name('vultisig').version('1.0.0').command('balance')

    let completed = false
    const execution = executeSchema(program).then(() => {
      completed = true
    })

    expect(stdout).toHaveBeenCalledOnce()
    expect(completed).toBe(false)

    flush?.()
    await execution

    expect(completed).toBe(true)
  })
})
