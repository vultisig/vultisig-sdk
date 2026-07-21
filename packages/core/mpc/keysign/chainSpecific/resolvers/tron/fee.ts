import { Buffer } from 'buffer'
import { AccountCoinKey } from '@vultisig/core-chain/coin/AccountCoin'
import { getTronAccountResources } from '@vultisig/core-chain/chains/tron/resources/getTronAccountResources'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import base58 from 'bs58'

import { getEnergyPrice } from './energyPrice'

type TriggerContractResponse = {
  result?: { result?: boolean; code?: string; message?: string }
  energy_used?: number
  energy_penalty?: number
}

type GetTrc20TransferFeeInput = {
  coin: AccountCoinKey
  amount: bigint
  receiver: string
}

function base58ToHex(address: string): string {
  const decoded = base58.decode(address)
  const addressBytes = decoded.slice(0, -4)
  return Buffer.from(addressBytes).toString('hex')
}

function buildTrc20TransferParameter(recipientBaseHex: string, amount: bigint): string {
  const cleanRecipientHex = recipientBaseHex.replace(/^0x/, '')
  const addressWithoutPrefix = cleanRecipientHex.slice(2)
  const paddedAddressHex = addressWithoutPrefix.padStart(64, '0')
  const amountHex = amount.toString(16)
  const paddedAmountHex = amountHex.padStart(64, '0')
  return paddedAddressHex + paddedAmountHex
}

export const getTrc20TransferFee = async ({ coin, receiver, amount }: GetTrc20TransferFeeInput): Promise<bigint> => {
  const recipientAddressHex = base58ToHex(receiver)
  const functionSelector = 'transfer(address,uint256)'

  const parameter = buildTrc20TransferParameter(recipientAddressHex, amount)

  const url = 'https://api.trongrid.io/wallet/triggerconstantcontract'

  const responseData = await queryUrl<TriggerContractResponse>(url, {
    headers: {
      accept: 'application/json',
    },
    body: {
      owner_address: coin.address,
      contract_address: coin.id,
      function_selector: functionSelector,
      parameter: parameter,
      visible: true,
    },
  })

  // triggerconstantcontract can return a 200 with an empty/malformed body or a
  // reverted simulation (result.result === false) without ever surfacing an
  // HTTP error. Trusting energy_used=0 in that case silently produces
  // feeLimit=0 downstream, which guarantees OUT_OF_ENERGY at broadcast. Throw
  // instead so it bubbles through the same throw-bubbling contract as network
  // errors above.
  if (!responseData.result || responseData.result.result !== true) {
    const reason = responseData.result?.message ?? 'empty or malformed response (possible TronGrid indexing lag)'
    throw new Error(`[tron] triggerconstantcontract did not return a successful estimate: ${reason}`)
  }

  const energyUsed = responseData.energy_used ?? 0
  const energyPenalty = responseData.energy_penalty ?? 0
  const totalEnergy = BigInt(energyUsed) + BigInt(energyPenalty)

  // Clamp negative totals to 0. TronGrid edge cases can return negative energy
  // values which, multiplied by energyPrice, produce a negative int64 in the
  // protobuf feeLimit field via `Long.fromString(gasEstimation.toString())`.
  // TronGrid rejects negative feeLimit at broadcast. Send-service path has a
  // similar guard at sdk/src/chains/tron/tx.ts:391; mirror it here for the MPC
  // keysign path. Returning 0 lets the upstream estimator pick a sane default.
  if (totalEnergy <= 0n) {
    return 0n
  }

  // Subtract sender's available staked energy before computing the burn cost.
  // Mirrors iOS TronService.swift:117-126 intent — falls back to worst-case on
  // fetch failure so fee is never under-estimated.
  let energyToBurn = totalEnergy
  try {
    const resources = await getTronAccountResources(coin.address)
    const availableEnergy = BigInt(resources.energy.available)
    if (availableEnergy >= totalEnergy) {
      energyToBurn = 0n
    } else if (availableEnergy > 0n) {
      energyToBurn = totalEnergy - availableEnergy
    }
  } catch (err) {
    console.warn('[tron] failed to fetch account energy resources, falling back to worst-case fee', err)
  }

  const energyPrice = await getEnergyPrice()
  const totalSun = energyToBurn * energyPrice

  // feeLimit is a spending CEILING, not an expected cost. Pad for drift during the
  // 10-60s MPC ceremony (dynamic energy pricing, concurrent staked-energy use),
  // cap so a pathological estimate can't runaway. 100 TRX cap matches the existing
  // send-service ceiling (packages/sdk/src/chains/tron/tx.ts:121).
  const FEE_LIMIT_MARGIN_BPS = 5_000n // +50%
  const FEE_LIMIT_CAP_SUN = 100_000_000n // 100 TRX
  const withMargin = totalSun + (totalSun * FEE_LIMIT_MARGIN_BPS) / 10_000n

  return withMargin > FEE_LIMIT_CAP_SUN ? FEE_LIMIT_CAP_SUN : withMargin
}
