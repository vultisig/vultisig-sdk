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

type WaitForSetupMessageInAnyInput = {
  serverUrl: string
  sessionId: string
  messageIds: (string | undefined)[]
}

/**
 * Polls the relay for the setup message across multiple `message_id` namespaces
 * in parallel. Different platforms write the shared setup to different namespaces
 * (Android/pre-#4246-iOS use the default; post-#4246 iOS uses `p-ecdsa`), so a
 * cross-platform joiner has to look in all of them. Resolves with the first
 * namespace to return the bytes; rejects (AggregateError) only if every
 * namespace fails.
 */
export const waitForSetupMessageInAny = async ({
  serverUrl,
  sessionId,
  messageIds,
}: WaitForSetupMessageInAnyInput): Promise<{
  foundAt: string | undefined
  setupMessage: string
}> =>
  Promise.any(
    messageIds.map(messageId =>
      waitForSetupMessage({ serverUrl, sessionId, messageId }).then(
        setupMessage => ({ foundAt: messageId, setupMessage })
      )
    )
  )
