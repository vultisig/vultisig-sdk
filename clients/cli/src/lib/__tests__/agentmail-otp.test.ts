import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchVaultOtp } from '../agentmail-otp'

// Helper to build a fetch mock that returns a sequence of JSON bodies keyed by
// URL substring. List requests return the inbox; message requests return text.
function mockFetch(responses: Array<{ match: string; body: any; ok?: boolean }>) {
  // Match the LONGEST matching pattern so a message-detail URL
  // (".../messages/m-1") doesn't get captured by the list pattern ("/messages").
  const ordered = [...responses].sort((a, b) => b.match.length - a.match.length)
  return vi.fn(async (url: string) => {
    const r = ordered.find(x => url.includes(x.match))
    if (!r) throw new Error('unexpected fetch url: ' + url)
    return {
      ok: r.ok ?? true,
      status: r.ok === false ? 500 : 200,
      statusText: r.ok === false ? 'err' : 'OK',
      json: async () => r.body,
    } as any
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchVaultOtp', () => {
  it('extracts the OTP from a message matched by vault name', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        {
          match: '/messages',
          body: {
            messages: [
              { message_id: 'm-other', subject: 'unrelated', preview: 'hi' },
              { message_id: 'm-1', subject: 'Verify MyTestVault', preview: 'code inside' },
            ],
          },
        },
        { match: '/messages/m-1', body: { text: 'Your Vultisig code is 482913. Expires soon.' } },
      ])
    )
    const code = await fetchVaultOtp({
      inboxEmail: 'vs_dev@agentmail.to',
      apiKey: 'test-key',
      vaultName: 'MyTestVault',
      maxAttempts: 2,
      intervalMs: 1,
    })
    expect(code).toBe('482913')
  })

  it('matches on preview when the subject does not contain the vault name', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        {
          match: '/messages',
          body: { messages: [{ message_id: 'm-2', subject: 'Verification', preview: 'For MyTestVault' }] },
        },
        { match: '/messages/m-2', body: { extracted_text: 'OTP: 5678' } },
      ])
    )
    const code = await fetchVaultOtp({
      inboxEmail: 'vs_dev@agentmail.to',
      apiKey: 'test-key',
      vaultName: 'MyTestVault',
      maxAttempts: 2,
      intervalMs: 1,
    })
    expect(code).toBe('5678')
  })

  it('throws a timeout error when no matching message arrives', async () => {
    vi.stubGlobal('fetch', mockFetch([{ match: '/messages', body: { messages: [] } }]))
    await expect(
      fetchVaultOtp({
        inboxEmail: 'vs_dev@agentmail.to',
        apiKey: 'test-key',
        vaultName: 'Nope',
        maxAttempts: 2,
        intervalMs: 1,
      })
    ).rejects.toThrow(/Timed out/)
  })

  it('does not include the api key in the thrown error', async () => {
    vi.stubGlobal('fetch', mockFetch([{ match: '/messages', body: { messages: [] } }]))
    const err: Error = await fetchVaultOtp({
      inboxEmail: 'vs_dev@agentmail.to',
      apiKey: 'super-secret-key',
      vaultName: 'Nope',
      maxAttempts: 1,
      intervalMs: 1,
    }).then(
      () => new Error('should have thrown'),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    )
    expect(err.message).not.toContain('super-secret-key')
  })
})
