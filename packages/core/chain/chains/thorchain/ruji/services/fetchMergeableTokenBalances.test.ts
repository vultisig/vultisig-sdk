import { describe, expect, it } from 'vitest'

import { fetchMergeableTokenBalances } from './fetchMergeableTokenBalances'

describe('fetchMergeableTokenBalances', () => {
  it('stays inert after the KUJI-to-RUJI merge window closed', async () => {
    await expect(fetchMergeableTokenBalances('thor1unused')).resolves.toEqual([])
  })
})
