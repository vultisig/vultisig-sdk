import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { blockaidBaseUrl } from '../config'

export const queryBlockaid = async <T>(
  route: `/${string}`,
  body: unknown
): Promise<T> =>
  queryUrl<T>(`${blockaidBaseUrl}${route}`, {
    body,
    headers: {
      origin: rootApiUrl,
    },
  })
