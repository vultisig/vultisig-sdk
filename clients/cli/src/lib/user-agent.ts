/**
 * Inject a custom User-Agent header into all fetch() calls made by this process.
 *
 * Wraps globalThis.fetch so every outgoing HTTP request includes
 * `User-Agent: vultisig-cli/<version>`. This only affects the CLI process —
 * the SDK itself does not set or require a User-Agent.
 */
import { getVersion } from './version'

export function setupUserAgent(): void {
  const userAgent = `vultisig-cli/${getVersion()}`
  const originalFetch = globalThis.fetch

  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> => {
    const headers = new Headers(init?.headers)
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', userAgent)
    }
    return originalFetch(input, { ...init, headers })
  }
}
