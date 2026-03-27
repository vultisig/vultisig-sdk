import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'

type DeleteRelayMessageInput = {
  serverUrl: string
  localPartyId: string
  sessionId: string
  messageHash: string
  messageId?: string
}

export const deleteMpcRelayMessage = async ({
  serverUrl,
  localPartyId,
  sessionId,
  messageHash,
  messageId,
}: DeleteRelayMessageInput) =>
  queryUrl(`${serverUrl}/message/${sessionId}/${localPartyId}/${messageHash}`, {
    method: 'DELETE',
    headers: withoutUndefinedFields({
      message_id: messageId,
    }),
    responseType: 'none',
  })
