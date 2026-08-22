import { Buffer } from 'buffer'
import { fromCardanoAssetId } from '@vultisig/core-chain/chains/cardano/asset/cardanoAssetId'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { buildCip20AuxData } from '../../../tx/compile/cardano/buildCip20AuxData'
import { SigningInputsResolver } from '../resolver'

/** Encodes a token amount as big-endian bytes for WalletCore's Cardano proto. */
const amountToBytes = (amount: bigint): Uint8Array => {
  const hex = amount.toString(16)
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`
  return Uint8Array.from(Buffer.from(padded, 'hex'))
}

// sdk#429: for a native-token (CNT) send, `keysignPayload.toAmount` is the
// token quantity in the token's own base units, NOT lovelace — it is NOT
// interchangeable with the recipient output's ADA value. Reusing it as
// `transferMessage.amount` (as done for plain ADA sends, where `toAmount` IS
// lovelace) produces a recipient output funded with e.g. 0.665 ADA for a
// 0.665 USDM send, below Cardano's min-UTxO floor (~0.85-1 ADA for a
// single-asset output) — the network rejects it post-signing (Ogmios 3125
// "insufficiently funded outputs"), after the co-signers already converged on
// signing the doomed body. WalletCore's Cardano planner does not compute or
// enforce min-UTxO on the output side (it only caps `plan.amount`, never
// raises it), so nothing downstream saves us from an under-funded output.
// Static 1.5 ADA comfortably covers a single-asset CNT output; computing the
// exact min-UTxO from the bundle's CBOR size is an explicit follow-up (not
// needed while a send supports at most one CNT per transfer).
const CARDANO_CNT_MIN_UTXO_LOVELACE = 1_500_000n

export const getCardanoSigningInputs: SigningInputsResolver<'cardano'> = ({ keysignPayload, walletCore }) => {
  const { sendMaxAmount, ttl, byteFee } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'cardano')

  const coin = shouldBePresent(keysignPayload.coin)
  const isTokenSend = coin.contractAddress !== ''

  // Send-max fee convergence (sdk#1382). WalletCore's Cardano planner IGNORES
  // `forceFee` whenever `useMaxAmount` is set — it returns TransactionPlan{ amount:
  // <full input>, fee: 0 }, an unbroadcastable zero-fee tx (nodes require
  // fee >= minFeeA + minFeeB*txSize). So we never take that path: a max send is
  // built as an EXPLICIT transfer of (totalInput - fee) with the converged fee
  // forced and `useMaxAmount: false`, which the planner honors (fee > 0, change
  // consumed to 0). The fee itself is converged by getCardanoChainSpecific, whose
  // loop calls back into this resolver — so it now prices the real fee-bearing
  // body instead of the fee=0 one. `useMaxAmount` without `forceFee` is not an
  // option: the planner aborts (uncatchable WASM assert) with no forced fee.
  const isSendMax = sendMaxAmount && !isTokenSend
  const sendAmount = isSendMax
    ? bigIntSum(keysignPayload.utxoInfo.map(({ amount }) => amount)) - byteFee
    : isTokenSend
      ? CARDANO_CNT_MIN_UTXO_LOVELACE
      : BigInt(keysignPayload.toAmount)

  // CIP-20 memo: hand the already-CBOR-encoded auxiliary data to WalletCore,
  // which commits its Blake2b-256 hash into the tx body (key 7) and embeds the
  // bytes in the signed transaction. No client-side body patching needed.
  const auxiliaryData = keysignPayload.memo ? buildCip20AuxData(keysignPayload.memo).auxDataCbor : undefined

  const tokenBundle = isTokenSend
    ? (() => {
        const { policyId, assetName } = fromCardanoAssetId(coin.contractAddress)

        return TW.Cardano.Proto.TokenBundle.create({
          token: [
            TW.Cardano.Proto.TokenAmount.create({
              policyId,
              assetNameHex: assetName,
              amount: amountToBytes(BigInt(keysignPayload.toAmount)),
            }),
          ],
        })
      })()
    : undefined

  const input = TW.Cardano.Proto.SigningInput.create({
    transferMessage: TW.Cardano.Proto.Transfer.create({
      toAddress: keysignPayload.toAddress,
      changeAddress: coin.address,
      amount: Long.fromString(sendAmount.toString()),
      useMaxAmount: false,
      tokenAmount: tokenBundle,
      forceFee: Long.fromString(byteFee.toString()),
    }),
    ttl: Long.fromString(ttl.toString()),
    auxiliaryData,

    utxos: keysignPayload.utxoInfo.map(({ hash, amount, index, cardanoTokens }) =>
      TW.Cardano.Proto.TxInput.create({
        outPoint: TW.Cardano.Proto.OutPoint.create({
          txHash: walletCore.HexCoding.decode(stripHexPrefix(hash)),
          outputIndex: Long.fromString(index.toString()),
        }),
        amount: Long.fromString(amount.toString()),
        address: coin.address,
        // Per-UTXO native assets, read verbatim off the keysign wire (the
        // initiator attached them). Without these WalletCore's planner cannot
        // reconcile input tokens into the change output: co-signing an
        // iOS-initiated send diverges on the pre-image hash, and an
        // SDK-initiated send builds a body that drops the input tokens (node
        // rejects it as value-not-conserved). Amounts are minimal big-endian
        // unsigned bytes — byte-identical to the iOS signer. Left unset for
        // token-free UTXOs, matching iOS.
        tokenAmount:
          cardanoTokens.length > 0
            ? cardanoTokens.map(token =>
                TW.Cardano.Proto.TokenAmount.create({
                  policyId: token.policyId,
                  assetNameHex: token.assetNameHex,
                  amount: amountToBytes(BigInt(token.amount)),
                })
              )
            : undefined,
      })
    ),
  })

  return [input]
}
