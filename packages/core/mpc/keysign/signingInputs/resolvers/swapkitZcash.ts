import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { parseSwapKitZcashPsbt } from '@vultisig/core-chain/chains/utxo/tx/parseSwapKitZcashPsbt'
import { p2pkhScriptForAddress } from '@vultisig/core-chain/chains/utxo/tx/p2pkhScriptForAddress'
import { getZcashBranchIdHex } from '@vultisig/core-chain/chains/utxo/zcashBranchId'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import Long from 'long'

import { KeysignPayload } from '../../../types/vultisig/keysign/v1/keysign_message_pb'

const parseQuotedAmount = (value: string): bigint => {
  if (!/^\d+$/u.test(value) || BigInt(value) <= 0n) throw new Error('Invalid SwapKit Zcash quoted source amount')
  return BigInt(value)
}

export const isSwapKitZcashPsbt = (payload: KeysignPayload): boolean =>
  payload.coin?.chain === Chain.Zcash &&
  payload.swapPayload.case === 'swapkitSwapPayload' &&
  ['PSBT', 'PSBT_ZEC'].includes(payload.swapPayload.value.txType.toUpperCase())

/** Build WalletCore's frozen Sapling input from the provider PSBT and a live branch ID. */
export const buildSwapKitZcashSigningInput = async (
  payload: KeysignPayload,
  walletCore: WalletCore
): Promise<TW.Bitcoin.Proto.SigningInput> => {
  if (!isSwapKitZcashPsbt(payload) || payload.swapPayload.case !== 'swapkitSwapPayload') {
    throw new Error('SwapKit Zcash signing requires a PSBT payload')
  }
  const coin = payload.coin
  const swap = payload.swapPayload.value
  if (
    !coin ||
    swap.fromCoin?.chain !== Chain.Zcash ||
    swap.fromCoin.address !== coin.address ||
    swap.targetAddress !== payload.toAddress
  ) {
    throw new Error('SwapKit Zcash PSBT source or destination disagrees with the keysign payload')
  }
  const quotedAmount = parseQuotedAmount(swap.fromAmount)
  const tx = parseSwapKitZcashPsbt(swap.txPayload)
  const senderScript = p2pkhScriptForAddress(Chain.Zcash, coin.address)
  const targetScript = p2pkhScriptForAddress(Chain.Zcash, swap.targetAddress)
  if (
    senderScript.equals(targetScript) ||
    tx.outputs.length > 2 ||
    !tx.outputs[0].scriptPubKey.equals(targetScript) ||
    tx.outputs[0].amount <= 0n ||
    tx.outputs[0].amount > quotedAmount ||
    (tx.outputs.length === 2 && (tx.outputs[1].amount <= 0n || !tx.outputs[1].scriptPubKey.equals(senderScript)))
  ) {
    throw new Error('SwapKit Zcash PSBT destination, change, or deposit amount is invalid')
  }
  if (tx.inputs.some(input => !input.scriptPubKey.equals(senderScript))) {
    throw new Error('SwapKit Zcash PSBT contains a foreign input script')
  }
  const totalIn = tx.inputs.reduce((sum, input) => sum + input.amount, 0n)
  const totalOut = tx.outputs.reduce((sum, output) => sum + output.amount, 0n)
  if (totalIn < totalOut || totalIn - totalOut > quotedAmount) {
    throw new Error('SwapKit Zcash PSBT miner fee is invalid')
  }

  const branchId = Buffer.from(await getZcashBranchIdHex(), 'hex')
  const coinType = getCoinType({ chain: Chain.Zcash, walletCore })
  const scriptHash = senderScript.subarray(3, 23)
  const utxos = tx.inputs.map(input =>
    TW.Bitcoin.Proto.UnspentTransaction.create({
      amount: Long.fromBigInt(input.amount),
      outPoint: TW.Bitcoin.Proto.OutPoint.create({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
      }),
      script: input.scriptPubKey,
    })
  )
  const plan = TW.Bitcoin.Proto.TransactionPlan.create({
    amount: Long.fromBigInt(tx.outputs[0].amount),
    availableAmount: Long.fromBigInt(totalIn),
    fee: Long.fromBigInt(totalIn - totalOut),
    change: Long.fromBigInt(tx.outputs[1]?.amount ?? 0n),
    utxos,
    branchId,
  })

  return TW.Bitcoin.Proto.SigningInput.create({
    coinType: coinType.value,
    hashType: walletCore.BitcoinScript.hashTypeForCoin(coinType),
    amount: Long.fromBigInt(tx.outputs[0].amount),
    useMaxAmount: false,
    toAddress: swap.targetAddress,
    changeAddress: coin.address,
    byteFee: Long.fromInt(1),
    lockTime: tx.locktime,
    scripts: { [scriptHash.toString('hex')]: walletCore.BitcoinScript.buildPayToPublicKeyHash(scriptHash).data() },
    utxo: utxos,
    plan,
  })
}
