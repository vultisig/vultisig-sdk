import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

const cacheTtlMs = 60 * 60 * 1000
const rpcTimeoutMs = 10_000
const zcashRpcUrl = `${rootApiUrl}/zcash/`

type ZcashBlockchainInfoResponse = {
  result?: {
    consensus?: {
      nextblock?: string
    }
  }
  error?: {
    message?: string
  } | null
}

type Cache = {
  value: string
  expiresAt: number
}

let cache: Cache | undefined
let inFlight: Promise<string> | undefined

const assertFourByteHex = (hex: string): string => {
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) {
    throw new Error(`Invalid Zcash consensus branch id: expected 4-byte hex, received "${hex}"`)
  }

  return hex.toLowerCase()
}

export const zcashBranchIdToWalletCoreHex = (bigEndianHex: string): string => {
  const hex = assertFourByteHex(bigEndianHex)
  return hex.match(/../g)!.reverse().join('')
}

export const zcashBranchIdToNumber = (bigEndianHex: string): number =>
  Number.parseInt(assertFourByteHex(bigEndianHex), 16)

const fetchZcashBranchIdHex = async (): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, rpcTimeoutMs)

  let response: ZcashBlockchainInfoResponse
  try {
    response = await queryUrl<ZcashBlockchainInfoResponse>(zcashRpcUrl, {
      body: {
        jsonrpc: '1.0',
        id: 'vultisig-sdk',
        method: 'getblockchaininfo',
        params: [],
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Zcash RPC timed out while fetching consensus branch id')
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (response.error) {
    throw new Error(`Zcash RPC error: ${response.error.message ?? 'unknown error'}`)
  }

  const nextBlock = response.result?.consensus?.nextblock
  if (!nextBlock) {
    throw new Error('Zcash RPC response is missing consensus.nextblock')
  }

  return zcashBranchIdToWalletCoreHex(nextBlock)
}

export const getZcashBranchIdHex = async (): Promise<string> => {
  const now = Date.now()
  if (cache && cache.expiresAt > now) {
    return cache.value
  }

  if (!inFlight) {
    inFlight = fetchZcashBranchIdHex()
      .then(value => {
        cache = {
          value,
          expiresAt: Date.now() + cacheTtlMs,
        }
        return value
      })
      .finally(() => {
        inFlight = undefined
      })
  }

  return inFlight
}

export const getZcashBranchId = async (): Promise<number> => {
  const walletCoreHex = await getZcashBranchIdHex()
  const bigEndianHex = walletCoreHex.match(/../g)!.reverse().join('')
  return zcashBranchIdToNumber(bigEndianHex)
}

export const resetZcashBranchIdCacheForTests = () => {
  cache = undefined
  inFlight = undefined
}
