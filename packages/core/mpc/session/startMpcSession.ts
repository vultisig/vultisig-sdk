import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { sleep } from '@vultisig/lib-utils/sleep'

type StartMpcSessionInput = {
  serverUrl: string
  sessionId: string
  devices: string[]
}

export const startMpcSession = async ({ serverUrl, sessionId, devices }: StartMpcSessionInput) =>
  queryUrl(`${serverUrl}/start/${sessionId}`, {
    body: devices,
    responseType: 'none',
  })

type StartMpcSessionWithRetryOptions = {
  maxAttempts?: number
  baseDelayMs?: number
}

/**
 * If POST /start loses the HTTP response but the relay applied it, GET /start/{sessionId}
 * returns the participant list (same shape as keysign cosigner wait loop).
 */
async function relaySessionStartAlreadyApplied({
  serverUrl,
  sessionId,
  devices,
}: StartMpcSessionInput): Promise<boolean> {
  try {
    const signers = await queryUrl<string[]>(`${serverUrl}/start/${sessionId}`)
    if (!Array.isArray(signers) || signers.length === 0) return false
    if (signers.length !== devices.length) return false
    const expected = new Set(devices)
    return signers.every(id => expected.has(id))
  } catch {
    return false
  }
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
      if (await relaySessionStartAlreadyApplied(input)) {
        return
      }
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt)
      }
    }
  }
  if (await relaySessionStartAlreadyApplied(input)) {
    return
  }
  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error(String(lastError))
}
