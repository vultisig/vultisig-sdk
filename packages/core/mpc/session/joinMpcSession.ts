import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type JoinMpcSessionInput = {
  serverUrl: string
  sessionId: string
  localPartyId: string
}

export const joinMpcSession = async ({
  serverUrl,
  sessionId,
  localPartyId,
}: JoinMpcSessionInput) =>
  queryUrl(`${serverUrl}/${sessionId}`, {
    body: [localPartyId],
    responseType: 'none',
  })
