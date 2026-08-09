import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { thorchainMidgardBaseUrl } from '@vultisig/core-chain/chains/cosmos/thor/lp/pools'

export const swapArrivalProviders = ['thorchain', 'mayachain', 'skip', 'li.fi'] as const

export type SwapArrivalProvider = (typeof swapArrivalProviders)[number]

export type SwapArrivalPendingStage = 'inbound' | 'confirming' | 'swapping' | 'outbound' | 'refunding'

type SwapArrivalStatusBase = {
  provider: SwapArrivalProvider
  txHash: string
  destinationTxHash?: string
  message?: string
}

export type SwapArrivalStatusResult =
  | (SwapArrivalStatusBase & { status: 'pending'; stage: SwapArrivalPendingStage })
  | (SwapArrivalStatusBase & { status: 'success'; stage: 'complete' })
  | (SwapArrivalStatusBase & { status: 'refunded'; stage: 'refunded' })
  | (SwapArrivalStatusBase & { status: 'not_found'; stage: 'not_found' })
  | (SwapArrivalStatusBase & { status: 'error'; stage: 'failed' })

export type SwapArrivalStatusHosts = {
  thorchainNode: string
  thorchainMidgard: string
  mayachainNode: string
  mayachainMidgard: string
  skip: string
  lifi: string
}

export const defaultSwapArrivalStatusHosts: SwapArrivalStatusHosts = {
  thorchainNode: `${cosmosRpcUrl[Chain.THORChain]}/thorchain`,
  thorchainMidgard: thorchainMidgardBaseUrl,
  mayachainNode: `${cosmosRpcUrl[Chain.MayaChain]}/mayachain`,
  mayachainMidgard: 'https://midgard.mayachain.info',
  skip: 'https://api.skip.build',
  lifi: 'https://li.quest',
}

type GetSwapArrivalStatusBase = {
  txHash: string
  hosts?: Partial<SwapArrivalStatusHosts>
  fetchImpl?: typeof fetch
  headers?: HeadersInit
  signal?: AbortSignal
}

export type GetSwapArrivalStatusInput =
  | (GetSwapArrivalStatusBase & { provider: 'thorchain' | 'mayachain' })
  | (GetSwapArrivalStatusBase & { provider: 'skip'; chainId: string })
  | (GetSwapArrivalStatusBase & {
      provider: 'li.fi'
      fromChain?: string | number
      toChain?: string | number
      bridge?: string
    })

type JsonRequestResult = { kind: 'ok'; data: unknown } | { kind: 'not_found' } | { kind: 'error'; error: Error }

type ThorMayaProvider = Extract<SwapArrivalProvider, 'thorchain' | 'mayachain'>

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getRecord = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const candidate = value[key]
  return isRecord(candidate) ? candidate : undefined
}

const getString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate : undefined
}

const getBoolean = (value: unknown, key: string): boolean | undefined => {
  if (!isRecord(value)) return undefined
  const candidate = value[key]
  return typeof candidate === 'boolean' ? candidate : undefined
}

const messageFromUnknown = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value
  if (!isRecord(value)) return undefined
  return getString(value, 'message') ?? getString(value, 'reason')
}

const requestJson = async (
  fetchImpl: typeof fetch,
  url: string,
  init: Pick<RequestInit, 'headers' | 'signal'>
): Promise<JsonRequestResult> => {
  try {
    const response = await fetchImpl(url, init)
    if (response.status === 404) return { kind: 'not_found' }
    if (!response.ok) {
      return { kind: 'error', error: new Error(`Swap arrival status request failed (${response.status}) for ${url}`) }
    }
    try {
      return { kind: 'ok', data: await response.json() }
    } catch (error) {
      return {
        kind: 'error',
        error: new Error(`Swap arrival status returned invalid JSON for ${url}`, { cause: error }),
      }
    }
  } catch (error) {
    return {
      kind: 'error',
      error: error instanceof Error ? error : new Error(`Swap arrival status request failed for ${url}`),
    }
  }
}

export class SwapArrivalStatusRequestError extends Error {
  readonly provider: SwapArrivalProvider
  readonly errors: Error[]

  constructor(provider: SwapArrivalProvider, errors: Error[]) {
    super(`Unable to read ${provider} swap arrival status: ${errors.map(error => error.message).join('; ')}`)
    this.name = 'SwapArrivalStatusRequestError'
    this.provider = provider
    this.errors = errors
  }
}

const resultBase = (provider: SwapArrivalProvider, txHash: string): SwapArrivalStatusBase => ({
  provider,
  txHash,
})

const findDestinationTxHash = (value: unknown, sourceTxHash: string): string | undefined => {
  const source = sourceTxHash.toLowerCase()
  const found: string[] = []

  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 12 || candidate === null || candidate === undefined) return
    if (Array.isArray(candidate)) {
      candidate.forEach(item => visit(item, depth + 1))
      return
    }
    if (!isRecord(candidate)) return

    for (const [key, child] of Object.entries(candidate)) {
      if ((key === 'txID' || key === 'txHash' || key === 'tx_hash') && typeof child === 'string') {
        const trimmed = child.trim()
        if (trimmed && trimmed.toLowerCase() !== source) found.push(trimmed)
      } else {
        visit(child, depth + 1)
      }
    }
  }

  visit(value, 0)
  return found.at(-1)
}

const completed = (stage: unknown): boolean => getBoolean(stage, 'completed') === true

const started = (stage: unknown): boolean => getBoolean(stage, 'started') === true || completed(stage)

const getThorMayaNodeProgress = (
  provider: ThorMayaProvider,
  txHash: string,
  data: unknown
): SwapArrivalStatusResult | undefined => {
  const stages = getRecord(data, 'stages')
  if (!stages) return undefined

  const outboundSigned = stages.outbound_signed
  const destinationTxHash = findDestinationTxHash(data, txHash)
  if (completed(outboundSigned)) {
    return { ...resultBase(provider, txHash), status: 'success', stage: 'complete', destinationTxHash }
  }

  if (isRecord(outboundSigned) || isRecord(stages.outbound_delay) || completed(stages.swap_finalised)) {
    return { ...resultBase(provider, txHash), status: 'pending', stage: 'outbound', destinationTxHash }
  }

  if (isRecord(stages.swap_status) || completed(stages.inbound_finalised)) {
    return { ...resultBase(provider, txHash), status: 'pending', stage: 'swapping' }
  }

  if (started(stages.inbound_confirmation_counted)) {
    return { ...resultBase(provider, txHash), status: 'pending', stage: 'confirming' }
  }

  if (started(stages.inbound_observed)) {
    return { ...resultBase(provider, txHash), status: 'pending', stage: 'inbound' }
  }

  return undefined
}

const getMidgardActions = (data: unknown): Record<string, unknown>[] => {
  if (!isRecord(data) || !Array.isArray(data.actions)) return []
  return data.actions.every(isRecord) ? data.actions : []
}

const isMidgardResponse = (data: unknown): boolean =>
  isRecord(data) && Array.isArray(data.actions) && data.actions.every(isRecord)

const isThorMayaNodeResponse = (data: unknown): boolean => isRecord(data) && isRecord(data.stages)

const getActionMessage = (action: Record<string, unknown>, type: 'refund' | 'swap'): string | undefined =>
  messageFromUnknown(getRecord(getRecord(action, 'metadata'), type))

const getThorMayaMidgardStatus = (
  provider: ThorMayaProvider,
  txHash: string,
  data: unknown,
  nodeProgress: SwapArrivalStatusResult | undefined
): SwapArrivalStatusResult | undefined => {
  const actions = getMidgardActions(data)
  const refund = actions.find(action => getString(action, 'type')?.toLowerCase() === 'refund')
  if (refund) {
    const status = getString(refund, 'status')?.toLowerCase()
    const destinationTxHash = findDestinationTxHash(refund, txHash)
    const message = getActionMessage(refund, 'refund')
    if (status === 'success') {
      return { ...resultBase(provider, txHash), status: 'refunded', stage: 'refunded', destinationTxHash, message }
    }
    if (status === 'pending') {
      return { ...resultBase(provider, txHash), status: 'pending', stage: 'refunding', destinationTxHash, message }
    }
    return { ...resultBase(provider, txHash), status: 'error', stage: 'failed', destinationTxHash, message }
  }

  const swap = actions.find(action => getString(action, 'type')?.toLowerCase() === 'swap')
  if (!swap) return undefined

  const status = getString(swap, 'status')?.toLowerCase()
  const destinationTxHash = findDestinationTxHash(swap, txHash)
  if (status === 'success') {
    return { ...resultBase(provider, txHash), status: 'success', stage: 'complete', destinationTxHash }
  }
  if (status === 'pending') {
    return nodeProgress ?? { ...resultBase(provider, txHash), status: 'pending', stage: 'swapping' }
  }
  return {
    ...resultBase(provider, txHash),
    status: 'error',
    stage: 'failed',
    destinationTxHash,
    message: getActionMessage(swap, 'swap'),
  }
}

const getThorMayaStatus = async ({
  provider,
  txHash,
  hosts,
  fetchImpl,
  headers,
  signal,
}: GetSwapArrivalStatusBase & {
  provider: ThorMayaProvider
  hosts: SwapArrivalStatusHosts
  fetchImpl: typeof fetch
}): Promise<SwapArrivalStatusResult> => {
  const isThorchain = provider === 'thorchain'
  const nodeBase = isThorchain ? hosts.thorchainNode : hosts.mayachainNode
  const midgardBase = isThorchain ? hosts.thorchainMidgard : hosts.mayachainMidgard
  const [node, midgard] = await Promise.all([
    requestJson(fetchImpl, `${trimTrailingSlash(nodeBase)}/tx/status/${encodeURIComponent(txHash)}`, {
      headers,
      signal,
    }),
    requestJson(fetchImpl, `${trimTrailingSlash(midgardBase)}/v2/actions?txid=${encodeURIComponent(txHash)}`, {
      headers,
      signal,
    }),
  ])

  const nodeProgress = node.kind === 'ok' ? getThorMayaNodeProgress(provider, txHash, node.data) : undefined
  const midgardStatus =
    midgard.kind === 'ok' ? getThorMayaMidgardStatus(provider, txHash, midgard.data, nodeProgress) : undefined

  if (midgardStatus) return midgardStatus
  if (nodeProgress) return nodeProgress

  const errors = [node, midgard].flatMap(result => (result.kind === 'error' ? [result.error] : []))
  if (node.kind === 'ok' && !isThorMayaNodeResponse(node.data)) {
    errors.push(new Error(`${provider} node returned an unknown transaction status response`))
  }
  if (midgard.kind === 'ok' && !isMidgardResponse(midgard.data)) {
    errors.push(new Error(`${provider} Midgard returned an unknown actions response`))
  }

  const midgardAuthoritativelyEmpty =
    midgard.kind === 'ok' && isMidgardResponse(midgard.data) && getMidgardActions(midgard.data).length === 0
  if (midgardAuthoritativelyEmpty || errors.length === 0) {
    return { ...resultBase(provider, txHash), status: 'not_found', stage: 'not_found' }
  }

  throw new SwapArrivalStatusRequestError(provider, errors)
}

const getSkipStatus = async ({
  txHash,
  chainId,
  hosts,
  fetchImpl,
  headers,
  signal,
}: GetSwapArrivalStatusBase & {
  chainId: string
  hosts: SwapArrivalStatusHosts
  fetchImpl: typeof fetch
}): Promise<SwapArrivalStatusResult> => {
  if (!chainId.trim()) throw new TypeError('getSwapArrivalStatus: chainId is required for Skip')

  const query = new URLSearchParams({ tx_hash: txHash, chain_id: chainId })
  const request = await requestJson(fetchImpl, `${trimTrailingSlash(hosts.skip)}/v2/tx/status?${query}`, {
    headers,
    signal,
  })
  if (request.kind === 'not_found') {
    return { ...resultBase('skip', txHash), status: 'not_found', stage: 'not_found' }
  }
  if (request.kind === 'error') throw new SwapArrivalStatusRequestError('skip', [request.error])

  const state = getString(request.data, 'state')
  const destinationTxHash = findDestinationTxHash(request.data, txHash)
  const message = messageFromUnknown(isRecord(request.data) ? request.data.error : undefined)
  if (state === 'STATE_COMPLETED_SUCCESS') {
    return { ...resultBase('skip', txHash), status: 'success', stage: 'complete', destinationTxHash }
  }
  if (state === 'STATE_SUBMITTED') {
    return { ...resultBase('skip', txHash), status: 'pending', stage: 'inbound', destinationTxHash }
  }
  if (state === 'STATE_PENDING' || state === 'STATE_PENDING_ERROR') {
    return { ...resultBase('skip', txHash), status: 'pending', stage: 'outbound', destinationTxHash, message }
  }
  if (state === 'STATE_ABANDONED' || state === 'STATE_COMPLETED_ERROR') {
    const assetRelease = getRecord(request.data, 'transfer_asset_release')
    const releasedOnSource =
      getBoolean(assetRelease, 'released') === true && getString(assetRelease, 'chain_id') === chainId
    if (releasedOnSource) {
      return { ...resultBase('skip', txHash), status: 'refunded', stage: 'refunded', destinationTxHash, message }
    }
    return { ...resultBase('skip', txHash), status: 'error', stage: 'failed', destinationTxHash, message }
  }

  throw new SwapArrivalStatusRequestError('skip', [new Error('Skip returned an unknown transaction state')])
}

const getLifiPendingStage = (substatus: string | undefined): SwapArrivalPendingStage => {
  if (substatus === 'WAIT_SOURCE_CONFIRMATIONS') return 'confirming'
  if (substatus === 'WAIT_DESTINATION_TRANSACTION') return 'outbound'
  if (substatus === 'REFUND_IN_PROGRESS') return 'refunding'
  return 'swapping'
}

const getLifiStatus = async ({
  txHash,
  fromChain,
  toChain,
  bridge,
  hosts,
  fetchImpl,
  headers,
  signal,
}: GetSwapArrivalStatusBase & {
  fromChain?: string | number
  toChain?: string | number
  bridge?: string
  hosts: SwapArrivalStatusHosts
  fetchImpl: typeof fetch
}): Promise<SwapArrivalStatusResult> => {
  const query = new URLSearchParams({ txHash })
  if (fromChain !== undefined) query.set('fromChain', String(fromChain))
  if (toChain !== undefined) query.set('toChain', String(toChain))
  if (bridge !== undefined) query.set('bridge', bridge)

  const request = await requestJson(fetchImpl, `${trimTrailingSlash(hosts.lifi)}/v1/status?${query}`, {
    headers,
    signal,
  })
  if (request.kind === 'not_found') {
    return { ...resultBase('li.fi', txHash), status: 'not_found', stage: 'not_found' }
  }
  if (request.kind === 'error') throw new SwapArrivalStatusRequestError('li.fi', [request.error])

  const status = getString(request.data, 'status')
  const substatus = getString(request.data, 'substatus')
  const destinationTxHash = getString(getRecord(request.data, 'receiving'), 'txHash')
  const message = getString(request.data, 'substatusMessage') ?? messageFromUnknown(getRecord(request.data, 'error'))

  if (substatus === 'REFUNDED') {
    return { ...resultBase('li.fi', txHash), status: 'refunded', stage: 'refunded', destinationTxHash, message }
  }
  if (status === 'DONE') {
    return { ...resultBase('li.fi', txHash), status: 'success', stage: 'complete', destinationTxHash, message }
  }
  if (status === 'PENDING') {
    return {
      ...resultBase('li.fi', txHash),
      status: 'pending',
      stage: getLifiPendingStage(substatus),
      destinationTxHash,
      message,
    }
  }
  if (status === 'NOT_FOUND') {
    return { ...resultBase('li.fi', txHash), status: 'not_found', stage: 'not_found', message }
  }
  if (status === 'INVALID' || status === 'FAILED') {
    return { ...resultBase('li.fi', txHash), status: 'error', stage: 'failed', destinationTxHash, message }
  }

  throw new SwapArrivalStatusRequestError('li.fi', [new Error('LI.FI returned an unknown transaction status')])
}

export const isSwapArrivalStatusTerminal = (result: SwapArrivalStatusResult): boolean => result.status !== 'pending'

/**
 * Reads one provider status snapshot and normalizes it for both UI progress and
 * terminal agent workflows. This function deliberately does not poll: callers
 * retain control of cadence, retry budgets and cancellation while sharing the
 * provider response state machines.
 *
 * Network, HTTP and malformed-response failures throw
 * `SwapArrivalStatusRequestError`; they are not converted to terminal `error`
 * results because an upstream outage does not mean the swap itself failed.
 */
export const getSwapArrivalStatus = async (input: GetSwapArrivalStatusInput): Promise<SwapArrivalStatusResult> => {
  const txHash = input.txHash.trim()
  if (!txHash) throw new TypeError('getSwapArrivalStatus: txHash must not be empty')

  const hostOverrides = Object.fromEntries(
    Object.entries(input.hosts ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<SwapArrivalStatusHosts>
  const hosts = { ...defaultSwapArrivalStatusHosts, ...hostOverrides }
  const fetchImpl = input.fetchImpl ?? fetch
  const common = { ...input, txHash, hosts, fetchImpl }

  if (input.provider === 'thorchain' || input.provider === 'mayachain') {
    return getThorMayaStatus({ ...common, provider: input.provider })
  }
  if (input.provider === 'skip') {
    return getSkipStatus({ ...common, chainId: input.chainId })
  }
  return getLifiStatus(common)
}
