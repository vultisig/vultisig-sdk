import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

/**
 * Poll the message relay until `requiredDevices` unique peers have joined, then return a sorted committee list.
 * Used by secure vault creation and secure seedphrase import (same relay semantics).
 */
export async function waitForRelayPeerCommittee(params: {
  relayUrl: string
  sessionId: string
  requiredDevices: number
  signal?: AbortSignal
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
  createTimeoutError: (lastJoinedCount: number, requiredDevices: number) => Error
}): Promise<string[]> {
  const { relayUrl, sessionId, requiredDevices, signal, onDeviceJoined, createTimeoutError } = params
  const maxWaitTime = 300000 // 5 minutes for multi-device setup
  const checkInterval = 2000
  const startTime = Date.now()
  let lastJoinedCount = 0

  while (Date.now() - startTime < maxWaitTime) {
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    try {
      const url = `${relayUrl}/${sessionId}`
      const allPeers = await queryUrl<string[]>(url)
      const uniquePeers = withoutDuplicates(allPeers)

      if (uniquePeers.length > lastJoinedCount && onDeviceJoined) {
        const newDevices = uniquePeers.slice(lastJoinedCount)
        for (const device of newDevices) {
          onDeviceJoined(device, uniquePeers.length, requiredDevices)
        }
        lastJoinedCount = uniquePeers.length
      }

      if (uniquePeers.length >= requiredDevices) {
        // Must match JoinSecureVaultService: sorted committee so all parties use identical order
        return [...uniquePeers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval))
    } catch {
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }
  }

  throw createTimeoutError(lastJoinedCount, requiredDevices)
}
