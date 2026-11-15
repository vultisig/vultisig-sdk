import { Chain } from '@vultisig/core-chain/Chain'
import { getCustomRpcOverride } from '@vultisig/core-chain/chains/customRpc/customRpcOverrides'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

export const nearMainnetRpcUrl = 'https://api.vultisig.com/near/'

/** Honors the app-wide override funnel so a user-configured node is used here too. */
export const getNearRpcUrl = (): string => getCustomRpcOverride(Chain.Near) ?? nearMainnetRpcUrl

type NearJsonRpcError = {
  code?: number
  message?: string
  name?: string
  cause?: { name?: string }
  data?: unknown
}

/**
 * The node affirmatively answered "there is no such account/key/transaction": a
 * valid answer, not a failed read. Keeping it distinct from transport and
 * malformed-response failures is what stops a broken RPC from reading as zero.
 */
export class NearUnknownEntityError extends Error {
  constructor(
    public readonly entity: 'account' | 'access key' | 'transaction',
    message: string
  ) {
    super(message)
    this.name = 'NearUnknownEntityError'
  }
}

/**
 * A JSON-RPC error the node returned (bad params, invalid transaction, timeout
 * …). `rpcName` is read from the top level or `cause.name`, because `query`
 * nests handler errors one level deeper than the transaction endpoints do. An
 * endpoint that sends neither reads as `UNKNOWN_ERROR`.
 */
export class NearRpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly rpcName: string,
    message: string,
    public readonly data: unknown
  ) {
    super(`NEAR ${method} failed (${rpcName}): ${message}`)
    this.name = 'NearRpcError'
  }
}

export const getNearRpcErrorName = (error: unknown): string | undefined => {
  if (error instanceof NearRpcError) {
    return error.rpcName
  }
  if (error instanceof NearUnknownEntityError) {
    return `UNKNOWN_${error.entity.toUpperCase().replace(' ', '_')}`
  }

  return undefined
}

/**
 * nearcore's whole not-found messages, for endpoints that relay `data` but drop
 * `name` and `cause` (api.vultisig.com/near/ does). Anchored at both ends, so a
 * failure that only mentions a missing record never reads as one.
 */
const nearcoreNotFoundMessages: [RegExp, string][] = [
  [/^account \S+ does not exist while viewing$/, 'UNKNOWN_ACCOUNT'],
  [/^Transaction \S+ doesn't exist$/, 'UNKNOWN_TRANSACTION'],
]

const readNotFoundName = (description: string): string | undefined =>
  nearcoreNotFoundMessages.find(([pattern]) => pattern.test(description))?.[1]

/**
 * Types a JSON-RPC error body. The structured name always wins; only a body with
 * neither `name` nor `cause` is matched against nearcore's not-found messages.
 */
export const toNearRpcError = (method: string, error: unknown): Error => {
  const { name, cause, data, message } = (error ?? {}) as NearJsonRpcError
  const description = typeof data === 'string' ? data : (message ?? JSON.stringify(error))
  const rpcName = cause?.name ?? name ?? readNotFoundName(description) ?? 'UNKNOWN_ERROR'

  if (rpcName === 'UNKNOWN_ACCOUNT') {
    return new NearUnknownEntityError('account', description)
  }
  if (rpcName === 'UNKNOWN_ACCESS_KEY') {
    return new NearUnknownEntityError('access key', description)
  }
  if (rpcName === 'UNKNOWN_TRANSACTION') {
    return new NearUnknownEntityError('transaction', description)
  }

  return new NearRpcError(method, rpcName, description, data)
}

/**
 * Raw body of a single JSON-RPC call; callers that must not lose integer
 * precision read the text themselves. The transport rejects non-2xx responses.
 */
export const callNearRpcText = (method: string, params: unknown): Promise<string> =>
  queryUrl<string>(getNearRpcUrl(), {
    method: 'POST',
    responseType: 'text',
    body: { jsonrpc: '2.0', id: method, method, params },
  })

export const parseNearRpcResponse = <T>(method: string, text: string): { result?: T; error?: unknown } => {
  let body: { result?: T; error?: unknown }

  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`NEAR ${method} returned a body that is not JSON`)
  }

  return body
}

/** POSTs a single JSON-RPC call and unwraps `result`, never a partial body. */
export const callNearRpc = async <T>(method: string, params: unknown): Promise<T> => {
  const { result, error } = parseNearRpcResponse<T>(method, await callNearRpcText(method, params))

  if (error) {
    throw toNearRpcError(method, error)
  }

  if (result === undefined) {
    throw new Error(`NEAR ${method} returned neither a result nor an error`)
  }

  return result
}
