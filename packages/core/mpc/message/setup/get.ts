import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { retry } from '@vultisig/lib-utils/query/retry'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'

type GetMpcSetupMessageInput = {
  serverUrl: string
  sessionId: string
  messageId?: string
}

const getMpcSetupMessage = async ({
  serverUrl,
  sessionId,
  messageId,
}: GetMpcSetupMessageInput) =>
  queryUrl(`${serverUrl}/setup-message/${sessionId}`, {
    headers: withoutUndefinedFields({
      message_id: messageId,
    }),
    responseType: 'text',
  })

export const waitForSetupMessage = async (
  input: GetMpcSetupMessageInput
): Promise<string> =>
  retry({
    func: () => getMpcSetupMessage(input),
    attempts: 50,
    delay: 200,
  })
