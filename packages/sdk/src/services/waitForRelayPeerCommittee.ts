import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { VaultError, VaultErrorCode } from '../vault/VaultError'

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
      throw new VaultError(VaultErrorCode.OperationAborted, 'Operation aborted')
    }

    const url = `${relayUrl}/${sessionId}`
    const { data: allPeers, error } = await attempt(queryUrl<string[]>(url))

    if (error || !allPeers) {
      await new Promise(resolve => setTimeout(resolve, checkInterval))
      continue
    }

    const uniquePeers = withoutDuplicates(allPeers)

    if (uniquePeers.length > requiredDevices) {
      throw new VaultError(
        VaultErrorCode.NetworkError,
        `Too many devices joined. Got ${uniquePeers.length}/${requiredDevices} devices.`
      )
    }

    if (uniquePeers.length > lastJoinedCount) {
      if (onDeviceJoined) {
        const newDevices = uniquePeers.slice(lastJoinedCount)
        for (const device of newDevices) {
          onDeviceJoined(device, uniquePeers.length, requiredDevices)
        }
      }
      lastJoinedCount = uniquePeers.length
    }

    if (uniquePeers.length === requiredDevices) {
      // Must match all parties: sorted committee so every device uses identical order.
      return [...uniquePeers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval))
  }

  throw createTimeoutError(lastJoinedCount, requiredDevices)
}
