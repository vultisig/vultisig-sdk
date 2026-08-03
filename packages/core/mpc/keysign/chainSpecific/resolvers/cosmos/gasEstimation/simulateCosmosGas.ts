import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/getCosmosRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type SimulateCosmosGasInput = {
  chain: CosmosChain
  /** base64-encoded protobuf `TxRaw` carrying a dummy signature */
  txBytes: string
}

type SimulateResponse = {
  gas_info?: {
    gas_used?: string
    gas_wanted?: string
  }
}

/**
 * Calls the LCD `/cosmos/tx/v1beta1/simulate` endpoint and returns the node's
 * reported `gas_used`. The endpoint decodes the tx and runs it against current
 * state WITHOUT verifying the signature, so the dummy signature in `txBytes` is
 * accepted. Throws on a network/parse failure or a non-positive `gas_used` so
 * the caller can fail closed to the static per-chain gas limit.
 */
export const simulateCosmosGas = async ({ chain, txBytes }: SimulateCosmosGasInput): Promise<bigint> => {
  const url = `${getCosmosRpcUrl(chain)}/cosmos/tx/v1beta1/simulate`

  const response = await queryUrl<SimulateResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { tx_bytes: txBytes },
  })

  const gasUsed = BigInt(response.gas_info?.gas_used ?? '0')
  if (gasUsed <= 0n) {
    throw new Error(`Cosmos simulate returned non-positive gas_used on ${chain}`)
  }

  return gasUsed
}
