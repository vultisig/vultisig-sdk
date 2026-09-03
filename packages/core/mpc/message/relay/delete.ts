import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'

import { withMpcRelayRequestSignal } from './get'

type DeleteRelayMessageInput = {
  serverUrl: string
  localPartyId: string
  sessionId: string
  messageHash: string
  messageId?: string
  signal?: AbortSignal
}

export const deleteMpcRelayMessage = async ({
  serverUrl,
  localPartyId,
  sessionId,
  messageHash,
  messageId,
  signal,
}: DeleteRelayMessageInput) => {
  const url = `${serverUrl}/message/${sessionId}/${localPartyId}/${messageHash}`
  const request = (effectiveSignal?: AbortSignal) =>
    queryUrl(url, {
      method: 'DELETE',
      headers: withoutUndefinedFields({
        message_id: messageId,
      }),
      responseType: 'none',
      signal: effectiveSignal,
    })

  return signal ? withMpcRelayRequestSignal(signal, url, request) : request()
}
