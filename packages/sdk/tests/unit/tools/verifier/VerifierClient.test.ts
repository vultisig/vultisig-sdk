import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryUrl = vi.fn()

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => mockQueryUrl(...args),
}))

import { VerifierClient } from '@/tools/verifier/VerifierClient'

describe('VerifierClient', () => {
  let client: VerifierClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new VerifierClient('http://localhost:8080')
  })

  describe('getRecipeSchema', () => {
    it('fetches plugin schema', async () => {
      mockQueryUrl.mockResolvedValue({
        supported_resources: ['erc20'],
        examples: [{ name: 'example' }],
      })

      const result = await client.getRecipeSchema('my-plugin')

      expect(result.supported_resources).toEqual(['erc20'])
      expect(mockQueryUrl).toHaveBeenCalledWith('http://localhost:8080/plugins/my-plugin/recipe-specification')
    })

    it('throws on failure', async () => {
      mockQueryUrl.mockResolvedValue(null)

      await expect(client.getRecipeSchema('bad-plugin')).rejects.toThrow('Failed to fetch recipe schema')
    })
  })

  describe('suggestPolicy', () => {
    it('posts configuration and returns policy', async () => {
      mockQueryUrl.mockResolvedValue({
        rules: [{ type: 'transfer', constraints: [] }],
      })

      const result = await client.suggestPolicy('my-plugin', { max_amount: 100 })

      expect(result.rules).toHaveLength(1)
      expect(mockQueryUrl).toHaveBeenCalledWith(
        'http://localhost:8080/plugins/my-plugin/recipe-specification/suggest',
        { body: { max_amount: 100 } }
      )
    })
  })

  describe('checkPluginInstalled', () => {
    it('checks install status with service key header', async () => {
      mockQueryUrl.mockResolvedValue({ installed: true })

      const result = await client.checkPluginInstalled('my-plugin', '04abc123')

      expect(result.installed).toBe(true)
      expect(mockQueryUrl).toHaveBeenCalledWith(
        expect.stringContaining('public_key=04abc123'),
        expect.objectContaining({
          headers: { 'X-Service-Key': 'sdk' },
        })
      )
    })
  })

  describe('checkBillingStatus', () => {
    it('checks billing status', async () => {
      mockQueryUrl.mockResolvedValue({ active: true, trial: false })

      const result = await client.checkBillingStatus('04abc123')

      expect(result.active).toBe(true)
      expect(result.trial).toBe(false)
    })

    it('throws on failure', async () => {
      mockQueryUrl.mockResolvedValue(null)

      await expect(client.checkBillingStatus('bad')).rejects.toThrow('Failed to check billing status')
    })
  })

  describe('custom base URL', () => {
    it('uses default URL when none provided', () => {
      const defaultClient = new VerifierClient()
      expect(defaultClient).toBeDefined()
    })
  })

  describe('custom service key', () => {
    it('uses custom service key in headers', async () => {
      const customClient = new VerifierClient('http://localhost:8080', 'my-service')
      mockQueryUrl.mockResolvedValue({ installed: true })

      await customClient.checkPluginInstalled('my-plugin', '04abc123')

      expect(mockQueryUrl).toHaveBeenCalledWith(
        expect.stringContaining('public_key=04abc123'),
        expect.objectContaining({
          headers: { 'X-Service-Key': 'my-service' },
        })
      )
    })
  })
})
