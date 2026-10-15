import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  encodeP2pkhAddress,
  getP2pkhScriptKeyHash,
  getPublicKeyHash160,
} from '@vultisig/core-chain/chains/utxo/tx/p2pkhAddress'
import {
  parseSwapKitZcashPsbt,
  swapKitZcashPsbtTxType,
  verifySwapKitZcashPsbt,
} from '@vultisig/core-chain/chains/utxo/tx/swapKitZcashPsbt'
import { getZcashBranchIdHex } from '@vultisig/core-chain/chains/utxo/zcashBranchId'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import Long from 'long'

import { KeysignPayload } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayload } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'

/** `txType` spellings that mean "a PSBT" on a Zcash SwapKit payload: the wire value, blank, or the per-chain literal. */
const zcashPsbtTxTypes = ['', 'PSBT', swapKitZcashPsbtTxType]

/**
 * The SwapKit payload of a Zcash keysign that carries SwapKit's pre-built PSBT
 * (sdk#2460), or `undefined` for any other keysign. A SwapKit payload with no
 * transaction bytes at all — under whatever `txType` the quote reported — is
 * the plain deposit transfer older SDK initiators produced and still signs
 * through the regular UTXO path. Any other `txType` on a payload that does
 * carry bytes is refused rather than signed as something it is not.
 */
export const getSwapKitZcashPsbtPayload = (keysignPayload: KeysignPayload): SwapKitSwapPayload | undefined => {
  if (keysignPayload.coin?.chain !== Chain.Zcash || keysignPayload.swapPayload.case !== 'swapkitSwapPayload') {
    return undefined
  }

  const swapKitPayload = keysignPayload.swapPayload.value
  if (swapKitPayload.txPayload.length === 0) {
    return undefined
  }

  const txType = swapKitPayload.txType.trim().toUpperCase()
  if (!zcashPsbtTxTypes.includes(txType)) {
    throw new Error(`Unsupported SwapKit Zcash transaction type "${swapKitPayload.txType}".`)
  }

  return swapKitPayload
}

type BuildSwapKitZcashSigningInputInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  /** This vault's compressed secp256k1 public key for Zcash; every PSBT input must lock to it. */
  publicKey: Uint8Array
}

/**
 * WalletCore signing input for SwapKit's Zcash PSBT with a frozen transaction
 * plan: the PSBT's own inputs, outputs (in order), fee and locktime, plus the
 * live consensus branch id, so WalletCore's ZIP-243 digest and the transaction
 * it compiles are the ones iOS (`SwapKitZcashSigner`) and Android
 * (`SwapKitZcashSigner`) produce from the same bytes. Letting WalletCore plan
 * would spend different inputs and sign a different transaction.
 *
 * WalletCore rebuilds the outputs from `toAddress` / `changeAddress`, so both
 * are derived from the PSBT's output scripts rather than from SwapKit's
 * declared `targetAddress`. The PSBT is bound to the vault's address and the
 * quote first, and refused when its inputs do not lock to `publicKey`, so no
 * hash is ever produced for an input this vault cannot sign.
 */
export const buildSwapKitZcashSigningInput = async ({
  keysignPayload,
  walletCore,
  publicKey,
}: BuildSwapKitZcashSigningInputInput): Promise<TW.Bitcoin.Proto.SigningInput> => {
  const swapKitPayload = shouldBePresent(getSwapKitZcashPsbtPayload(keysignPayload), 'SwapKit Zcash PSBT payload')
  const coin = shouldBePresent(keysignPayload.coin, 'keysign coin')

  const tx = parseSwapKitZcashPsbt(swapKitPayload.txPayload)
  const { senderScript } = verifySwapKitZcashPsbt({
    tx,
    senderAddress: coin.address,
    fromAmount: swapKitPayload.fromAmount,
  })

  const keyHash = shouldBePresent(getP2pkhScriptKeyHash(senderScript), 'vault P2PKH key hash')
  if (!keyHash.equals(getPublicKeyHash160(publicKey))) {
    throw new Error("SwapKit Zcash PSBT inputs do not lock to this vault's signing key.")
  }

  const coinType = getCoinType({ chain: Chain.Zcash, walletCore })
  const [depositOutput, changeOutput] = tx.outputs
  const outputAddress = ({ scriptPubKey }: { scriptPubKey: Buffer }) =>
    encodeP2pkhAddress({
      chain: Chain.Zcash,
      keyHash: shouldBePresent(getP2pkhScriptKeyHash(scriptPubKey), 'Zcash output key hash'),
    })

  const totalIn = bigIntSum(tx.inputs.map(({ amount }) => amount))
  const totalOut = bigIntSum(tx.outputs.map(({ amount }) => amount))

  const utxos = tx.inputs.map(input =>
    TW.Bitcoin.Proto.UnspentTransaction.create({
      amount: Long.fromString(input.amount.toString()),
      outPoint: TW.Bitcoin.Proto.OutPoint.create({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
      }),
      script: input.scriptPubKey,
    })
  )

  const plan = TW.Bitcoin.Proto.TransactionPlan.create({
    amount: Long.fromString(depositOutput.amount.toString()),
    availableAmount: Long.fromString(totalIn.toString()),
    fee: Long.fromString((totalIn - totalOut).toString()),
    change: Long.fromString((changeOutput?.amount ?? 0n).toString()),
    utxos,
    branchId: Buffer.from(await getZcashBranchIdHex(), 'hex'),
  })

  return TW.Bitcoin.Proto.SigningInput.create({
    hashType: walletCore.BitcoinScript.hashTypeForCoin(coinType),
    amount: Long.fromString(depositOutput.amount.toString()),
    useMaxAmount: false,
    toAddress: outputAddress(depositOutput),
    changeAddress: changeOutput ? outputAddress(changeOutput) : coin.address,
    // The frozen plan supersedes planning, so the fee rate is never used.
    byteFee: Long.fromInt(1),
    coinType: coinType.value,
    lockTime: tx.locktime,
    scripts: {
      [keyHash.toString('hex')]: walletCore.BitcoinScript.buildPayToPublicKeyHash(keyHash).data(),
    },
    utxo: utxos,
    plan,
  })
}
