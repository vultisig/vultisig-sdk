import { Chain } from '@vultisig/core-chain/Chain'

import { isChainOfKind } from '../../ChainKind'
import { getEvmChainId } from '../evm/chainInfo'

/**
 * Outcome of probing a candidate custom RPC endpoint for liveness (and, where
 * possible, network identity), so the Custom RPC editor can show a "Test"
 * result.
 */
export type RpcHealthResult =
  /**
   * The endpoint responded successfully. `networkVerified` is true only when the
   * probe could confirm the endpoint serves the expected chain (EVM
   * `eth_chainId` match); for chains without a cheap identity check it is a
   * liveness-only result.
   */
  | { status: 'reachable'; latencyMs: number; networkVerified: boolean }
  /** The endpoint did not respond, timed out, or returned a transport/HTTP error. */
  | { status: 'unreachable' }
  /** The endpoint is alive but serves a different chain than expected (EVM chainId mismatch). */
  | { status: 'wrongChain' }
  /** The endpoint responded but the payload could not be understood as the expected RPC shape. */
  | { status: 'invalidResponse' }

const probeTimeoutMs = 8_000
const cosmosNodeInfoPath = 'cosmos/base/tendermint/v1beta1/node_info'

const probeEvm = async (
  chain: Chain,
  url: string,
  signal: AbortSignal
): Promise<RpcHealthResult> => {
  const startedAt = Date.now()
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_chainId',
      params: [],
    }),
    signal,
  })
  const latencyMs = Date.now() - startedAt

  if (!response.ok) {
    return { status: 'unreachable' }
  }

  const body: { result?: unknown } = await response.json()
  if (typeof body.result !== 'string') {
    return { status: 'invalidResponse' }
  }

  const reportedChainId = Number.parseInt(body.result, 16)
  if (Number.isNaN(reportedChainId)) {
    return { status: 'invalidResponse' }
  }

  const expectedChainId = isChainOfKind(chain, 'evm')
    ? Number.parseInt(getEvmChainId(chain), 16)
    : undefined

  if (expectedChainId === undefined) {
    return { status: 'reachable', latencyMs, networkVerified: false }
  }

  return reportedChainId === expectedChainId
    ? { status: 'reachable', latencyMs, networkVerified: true }
    : { status: 'wrongChain' }
}

const probeCosmos = async (
  url: string,
  signal: AbortSignal
): Promise<RpcHealthResult> => {
  const startedAt = Date.now()
  // The LCD node_info endpoint confirms liveness. We don't verify the reported
  // network id against the chain here, so this stays a liveness-only result.
  const response = await fetch(
    `${url.replace(/\/+$/, '')}/${cosmosNodeInfoPath}`,
    { signal }
  )
  const latencyMs = Date.now() - startedAt

  return response.ok
    ? { status: 'reachable', latencyMs, networkVerified: false }
    : { status: 'unreachable' }
}

const probeReachability = async (
  url: string,
  signal: AbortSignal
): Promise<RpcHealthResult> => {
  const startedAt = Date.now()
  const response = await fetch(url, { signal })
  const latencyMs = Date.now() - startedAt

  return response.ok
    ? { status: 'reachable', latencyMs, networkVerified: false }
    : { status: 'unreachable' }
}

type ProbeRpcHealthInput = {
  chain: Chain
  url: string
}

/**
 * Probes a candidate custom RPC URL: EVM endpoints verify chain identity via
 * `eth_chainId`, Cosmos endpoints check LCD liveness, and any other chain falls
 * back to a plain reachability check. A timeout or transport error resolves to
 * `unreachable` rather than throwing.
 */
export const probeRpcHealth = async ({
  chain,
  url,
}: ProbeRpcHealthInput): Promise<RpcHealthResult> => {
  const endpoint = url.trim()
  if (!endpoint) {
    return { status: 'unreachable' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs)

  try {
    if (isChainOfKind(chain, 'evm')) {
      return await probeEvm(chain, endpoint, controller.signal)
    }
    if (isChainOfKind(chain, 'cosmos')) {
      return await probeCosmos(endpoint, controller.signal)
    }
    return await probeReachability(endpoint, controller.signal)
  } catch {
    return { status: 'unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}
