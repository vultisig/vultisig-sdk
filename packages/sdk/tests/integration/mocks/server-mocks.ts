/**
 * Server API Mocks for Testing
 *
 * Provides mock responses for Vultisig server endpoints:
 * - FastVault API (vault creation, verification, signing)
 * - Message Relay (MPC session coordination)
 */

import type { Mock } from 'vitest'
import { vi } from 'vitest'

/**
 * Default server endpoints
 */
export const DEFAULT_ENDPOINTS = {
  fastVault: 'https://api.vultisig.com/vault',
  messageRelay: 'https://api.vultisig.com/router',
}

/**
 * Generate a simple UUID for testing (Node.js compatible)
 */
function generateTestUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Mock response for vault creation (setupVaultWithServer)
 */
export function mockVaultCreationResponse() {
  return {
    session_id: generateTestUUID(),
    service_id: `service_${Date.now()}`,
    status: 'pending',
  }
}

/**
 * Mock response for email verification
 */
export function mockEmailVerificationResponse(verified = true) {
  return {
    status: verified ? 'verified' : 'pending',
    verified,
    timestamp: Date.now(),
  }
}

/**
 * Mock response for fast signing request
 */
export function mockFastSigningResponse() {
  return {
    session_id: generateTestUUID(),
    service_id: `sign_service_${Date.now()}`,
    status: 'ready',
  }
}

/**
 * Mock response for message relay session participants
 */
export function mockRelayParticipants(
  localPartyId: string,
  includeServer = true
) {
  const participants = [localPartyId]
  if (includeServer) {
    participants.push(`Server-${generateTestUUID().slice(0, 8)}`)
  }
  return participants
}

/**
 * Mock response for server ping/health check
 */
export function mockServerHealthResponse() {
  return {
    status: 'healthy',
    timestamp: Date.now(),
    version: '1.0.0',
  }
}

/**
 * Create a comprehensive fetch mock for all Vultisig server endpoints
 */
export function createVultisigServerMock(): Mock {
  const fetchMock = vi.fn()

  fetchMock.mockImplementation(
    async (url: string | URL | Request, options?: RequestInit) => {
      const urlString = url.toString()
      const method = options?.method || 'GET'

      // FastVault: Create/Setup vault
      if (
        urlString.includes('/vault') &&
        method === 'POST' &&
        !urlString.includes('/sign')
      ) {
        return createMockResponse(200, mockVaultCreationResponse())
      }

      // FastVault: Verify email code
      if (
        urlString.match(/\/vault\/verify\/[^/]+\/[^/]+/) &&
        method === 'GET'
      ) {
        return createMockResponse(200, mockEmailVerificationResponse(true))
      }

      // FastVault: Resend verification email
      if (urlString.includes('/resend-verification/') && method === 'GET') {
        return createMockResponse(200, { status: 'sent' })
      }

      // FastVault: Get vault from server
      if (urlString.includes('/vault/') && method === 'POST') {
        return createMockResponse(200, {
          password: 'encrypted_vault_data',
          vaultData: {},
        })
      }

      // FastVault: Sign with server
      if (urlString.includes('/sign') && method === 'POST') {
        return createMockResponse(200, mockFastSigningResponse())
      }

      // Message Relay: Join session (POST)
      if (urlString.includes('/router/') && method === 'POST') {
        const body = options?.body ? JSON.parse(options.body as string) : []
        return createMockResponse(201, { participants: body })
      }

      // Message Relay: Get participants (GET)
      if (urlString.includes('/router/') && method === 'GET') {
        const sessionId = urlString.split('/router/')[1]?.split('?')[0]
        const localPartyId = `client-${sessionId?.slice(0, 8) || 'test'}`
        return createMockResponse(200, mockRelayParticipants(localPartyId))
      }

      // Message Relay: Start session
      if (urlString.includes('/start') && method === 'POST') {
        return createMockResponse(200, { status: 'started' })
      }

      // Health check / Ping
      if (
        urlString.includes('/ping') ||
        (urlString.endsWith('/') && method === 'GET')
      ) {
        return createMockResponse(200, mockServerHealthResponse())
      }

      // Default: Not found
      console.warn(`Unmocked fetch request: ${method} ${urlString}`)
      return createMockResponse(404, { error: 'Not Found' })
    }
  )

  return fetchMock
}

/**
 * Create a failing server mock for error testing
 */
export function createFailingServerMock(
  errorType: 'network' | 'timeout' | '500' = 'network'
): Mock {
  const fetchMock = vi.fn()

  fetchMock.mockImplementation(async () => {
    switch (errorType) {
      case 'network':
        throw new Error('Network request failed')
      case 'timeout':
        throw new Error('Request timeout')
      case '500':
        return createMockResponse(500, { error: 'Internal Server Error' })
      default:
        throw new Error('Unknown error')
    }
  })

  return fetchMock
}

/**
 * Create a slow server mock for testing timeouts and loading states
 */
export function createSlowServerMock(delayMs: number = 5000): Mock {
  const fetchMock = createVultisigServerMock()
  const originalImpl = fetchMock.getMockImplementation()

  fetchMock.mockImplementation(async (...args: any[]) => {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return originalImpl?.(...args)
  })

  return fetchMock
}

/**
 * Helper to create mock Response objects
 */
function createMockResponse(status: number, data: any): Response {
  const jsonData = JSON.stringify(data)

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: getStatusText(status),
    headers: new Headers({
      'Content-Type': 'application/json',
    }),
    json: async () => data,
    text: async () => jsonData,
    arrayBuffer: async () => new TextEncoder().encode(jsonData).buffer,
    blob: async () => new Blob([jsonData]),
    clone: function () {
      return this
    },
  } as Response
}

/**
 * Get HTTP status text
 */
function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    400: 'Bad Request',
    404: 'Not Found',
    500: 'Internal Server Error',
  }
  return statusTexts[status] || 'Unknown'
}

/**
 * Setup global fetch mock for tests
 */
export function setupServerMocks() {
  const mockFetch = createVultisigServerMock()
  global.fetch = mockFetch as any
  return mockFetch
}

/**
 * Reset server mocks between tests
 */
export function resetServerMocks() {
  vi.clearAllMocks()
}

/**
 * Get mock call history for debugging
 */
export function getServerMockCallHistory(mock: Mock) {
  return {
    totalCalls: mock.mock.calls.length,
    calls: mock.mock.calls.map(call => ({
      url: call[0]?.toString(),
      method: call[1]?.method || 'GET',
      body: call[1]?.body,
    })),
    lastCall: mock.mock.calls[mock.mock.calls.length - 1],
  }
}

/**
 * Assert that a specific endpoint was called
 */
export function assertEndpointCalled(
  mock: Mock,
  urlPattern: string,
  method: string = 'GET',
  times?: number
) {
  const matchingCalls = mock.mock.calls.filter(call => {
    const url = call[0]?.toString() || ''
    const callMethod = call[1]?.method || 'GET'
    return url.includes(urlPattern) && callMethod === method
  })

  if (times !== undefined) {
    if (matchingCalls.length !== times) {
      throw new Error(
        `Expected ${urlPattern} (${method}) to be called ${times} times, but was called ${matchingCalls.length} times`
      )
    }
  } else {
    if (matchingCalls.length === 0) {
      throw new Error(
        `Expected ${urlPattern} (${method}) to be called at least once, but was never called`
      )
    }
  }

  return matchingCalls
}
