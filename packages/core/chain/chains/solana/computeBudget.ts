import { PublicKey, VersionedMessage } from '@solana/web3.js'

import { solanaConfig } from './solanaConfig'

const computeBudgetProgramId = new PublicKey('ComputeBudget111111111111111111111111111111')

/** ComputeBudget `SetComputeUnitLimit` / `SetComputeUnitPrice` one-byte tags. */
export const computeBudgetDiscriminators = { setUnitLimit: 2, setUnitPrice: 3 } as const

const littleEndianBigInt = (bytes: Uint8Array): bigint =>
  bytes.reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n)

/** `SetComputeUnitLimit`'s `u32` argument. */
export const computeUnitLimitArgument = (data: Uint8Array): number | undefined => {
  if (data.length !== 5 || data[0] !== computeBudgetDiscriminators.setUnitLimit) return undefined
  return Number(littleEndianBigInt(data.slice(1, 5)))
}

/**
 * `SetComputeUnitPrice`'s `u64` argument, in micro-lamports per compute unit.
 * The fee it produces is `price × limit`, so this is a spend.
 */
export const computeUnitPriceArgument = (data: Uint8Array): bigint | undefined => {
  if (data.length !== 9 || data[0] !== computeBudgetDiscriminators.setUnitPrice) return undefined
  return littleEndianBigInt(data.slice(1, 9))
}

const maxComputeUnitLimit = 1_400_000n
const defaultInstructionComputeUnitLimit = 200_000n
const microLamportsPerLamport = 1_000_000n

/**
 * What the runtime charges for a transaction message: the base fee for each
 * required signature plus the prioritization fee its ComputeBudget
 * instructions set, rounded up to a whole lamport as the runtime rounds it.
 *
 * A price without a limit is charged against the default limit, taken here as
 * 200,000 units per other instruction up to the 1.4M cap. Runtimes that reserve
 * less for builtin programs charge at most that. Program ids are never loaded
 * from address lookup tables, so the message alone is enough.
 */
export const getSolanaMessageFee = (message: VersionedMessage): bigint => {
  let unitLimit: bigint | undefined
  let unitPrice = 0n
  let otherInstructionCount = 0n

  for (const { programIdIndex, data } of message.compiledInstructions) {
    if (!message.staticAccountKeys[programIdIndex].equals(computeBudgetProgramId)) {
      otherInstructionCount += 1n
      continue
    }

    const limit = computeUnitLimitArgument(data)
    if (limit !== undefined) unitLimit = BigInt(limit)

    const price = computeUnitPriceArgument(data)
    if (price !== undefined) unitPrice = price
  }

  const requestedLimit = unitLimit ?? defaultInstructionComputeUnitLimit * otherInstructionCount
  const chargedLimit = requestedLimit < maxComputeUnitLimit ? requestedLimit : maxComputeUnitLimit
  const priorityFee = (unitPrice * chargedLimit + microLamportsPerLamport - 1n) / microLamportsPerLamport

  return BigInt(solanaConfig.baseFee) * BigInt(message.header.numRequiredSignatures) + priorityFee
}
