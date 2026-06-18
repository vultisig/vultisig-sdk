import { rootApiUrl } from '@vultisig/core-config'
import { NoDataError } from '@vultisig/lib-utils/error/NoDataError'
import { assertFetchResponse } from '@vultisig/lib-utils/fetch/assertFetchResponse'
import { sleep } from '@vultisig/lib-utils/sleep'

let lastRequestAt: number | null = null
const minTimeGap = 500

export const queryOneInch = async <T>(urlParams: string): Promise<T> => {
  const now = Date.now()

  if (lastRequestAt && lastRequestAt + minTimeGap > now) {
    await sleep(lastRequestAt + minTimeGap - now)
    return queryOneInch(urlParams)
  }

  lastRequestAt = now
  const url = `${rootApiUrl}/1inch${urlParams}`
  const response = await fetch(url)

  if (response.status === 404) {
    throw new NoDataError()
  }

  if (response.status === 429) {
    await sleep(minTimeGap)
    return queryOneInch(urlParams)
  }

  if (!response.ok) {
    await assertFetchResponse(response)
  }

  return response.json()
}
