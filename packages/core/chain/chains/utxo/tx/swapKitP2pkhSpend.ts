import { Chain } from '@vultisig/core-chain/Chain'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'
import { parseNonNegativeBigInt } from '@vultisig/lib-utils/bigint/parseNonNegativeBigInt'

type SpendOutput = {
  amount: bigint
  /** Pays back to the vault's own script. */
  isChange: boolean
}

type VerifySwapKitP2pkhSpendInput = {
  chain: Chain
  inputAmounts: bigint[]
  outputs: SpendOutput[]
  /** The quoted sell amount, in base units. */
  fromAmount: string | bigint
}

/**
 * Ties a SwapKit P2PKH transaction (DOGE, BCH, DASH or transparent ZEC) to the
 * quote a signer can see, and returns the value it moves out of the vault.
 *
 * Every input is already known to spend the vault's own script, so what is
 * bounded here is the other side: no more than the quoted amount may leave the
 * vault, and the miner fee may not exceed it either — a PSBT that under-funds
 * its change output would otherwise burn the remainder as fee. The deposit
 * recipient is deliberately not pinned to SwapKit's declared `targetAddress`:
 * the on-chain deposit address of a route can differ from it, and iOS and
 * Android apply this same binding, so pinning would refuse swaps they sign.
 */
export const verifySwapKitP2pkhSpend = ({ chain, inputAmounts, outputs, fromAmount }: VerifySwapKitP2pkhSpendInput) => {
  const quotedAmount = typeof fromAmount === 'bigint' ? fromAmount : parseQuotedAmount(chain, fromAmount)

  if (outputs.length === 0 || outputs.length > 2) {
    throw new Error(
      `SwapKit ${chain} PSBT must have one deposit output and at most one change output, but has ${outputs.length}.`
    )
  }
  if (outputs.some(({ amount }) => amount <= 0n)) {
    throw new Error(`SwapKit ${chain} PSBT contains a zero-valued output.`)
  }

  const totalIn = bigIntSum(inputAmounts)
  const totalOut = bigIntSum(outputs.map(({ amount }) => amount))
  const fee = totalIn - totalOut
  if (fee < 0n) {
    throw new Error(`SwapKit ${chain} PSBT spends ${totalOut} from inputs worth only ${totalIn}.`)
  }

  const deposit = bigIntSum(outputs.filter(({ isChange }) => !isChange).map(({ amount }) => amount))
  if (deposit === 0n) {
    throw new Error(`SwapKit ${chain} PSBT pays nothing out of the vault.`)
  }
  if (deposit > quotedAmount) {
    throw new Error(
      `SwapKit ${chain} PSBT sends ${deposit} out of the vault, more than the quoted swap amount ${quotedAmount}.`
    )
  }
  if (fee > quotedAmount) {
    throw new Error(`SwapKit ${chain} PSBT miner fee ${fee} exceeds the quoted swap amount ${quotedAmount}.`)
  }

  return deposit
}

const parseQuotedAmount = (chain: Chain, fromAmount: string): bigint => {
  try {
    return parseNonNegativeBigInt(fromAmount)
  } catch {
    throw new Error(`SwapKit ${chain} PSBT quoted amount is invalid: ${fromAmount}`)
  }
}
