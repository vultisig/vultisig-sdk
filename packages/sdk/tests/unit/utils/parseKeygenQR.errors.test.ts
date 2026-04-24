import { describe, expect, it } from 'vitest'

import { parseKeygenQR } from '@/utils/parseKeygenQR'

describe('parseKeygenQR — validation errors (before decompress)', () => {
  it('rejects payloads that do not use the vultisig scheme', async () => {
    await expect(parseKeygenQR('https://example.com')).rejects.toThrow('must start with vultisig://')
  })

  it('rejects payloads without query parameters', async () => {
    await expect(parseKeygenQR('vultisig://')).rejects.toThrow('missing query parameters')
  })

  it('rejects payloads without jsonData', async () => {
    await expect(parseKeygenQR('vultisig://?type=NewVault')).rejects.toThrow('missing jsonData')
  })
})
