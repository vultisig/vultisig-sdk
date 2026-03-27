import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'

type UploadMpcSetupMessageInput = {
  serverUrl: string
  message: string
  sessionId: string
  messageId?: string
}

export const uploadMpcSetupMessage = async ({
  serverUrl,
  message,
  sessionId,
  messageId,
}: UploadMpcSetupMessageInput) =>
  queryUrl(`${serverUrl}/setup-message/${sessionId}`, {
    headers: withoutUndefinedFields({
      message_id: messageId,
    }),
    body: message,
    responseType: 'none',
  })
