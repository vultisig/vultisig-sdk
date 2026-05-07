import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { sleep } from '@vultisig/lib-utils/sleep'

type StartMpcSessionInput = {
  serverUrl: string
  sessionId: string
  devices: string[]
}

export const startMpcSession = async ({
  serverUrl,
  sessionId,
  devices,
}: StartMpcSessionInput) =>
  queryUrl(`${serverUrl}/start/${sessionId}`, {
    body: devices,
    responseType: 'none',
  })

type StartMpcSessionWithRetryOptions = {
  maxAttempts?: number
  baseDelayMs?: number
}

/**
 * Retries POST /start/{sessionId} — relay must accept this before MPC messages
 * route reliably. Swallowing failures led to long empty-relay polls (~2× DKLS timeout).
 */
export const startMpcSessionWithRetry = async (
  input: StartMpcSessionInput,
  options?: StartMpcSessionWithRetryOptions
): Promise<void> => {
  const maxAttempts = options?.maxAttempts ?? 3
  const baseDelayMs = options?.baseDelayMs ?? 400
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await startMpcSession(input)
      return
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt)
      }
    }
  }
  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error(String(lastError))
}
