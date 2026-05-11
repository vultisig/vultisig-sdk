import { Buffer } from 'buffer'
import { fromCardanoAssetId } from '@vultisig/core-chain/chains/cardano/asset/cardanoAssetId'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { SigningInputsResolver } from '../resolver'

/**
 * Lovelace floor we attach to the recipient output of a CNT send. Cardano
 * (Babbage era) requires every output to carry a minimum ADA value that
 * scales with the bundle's CBOR size; a single-CNT output is typically
 * ~0.85 ADA. We use 1.5 ADA to leave headroom and avoid the network 3125
 * "insufficiently funded outputs" rejection. WalletCore's planner does NOT
 * auto-bump the output lovelace to min-UTxO — see Signer.cpp:481 (`plan.amount =
 * input.transfer_message().amount()`) and Signer.cpp:559-563 (only caps,
 * never bumps). We therefore have to set it ourselves.
 */
const minLovelaceOnTokenOutput = 1_500_000n

/** Encodes a token amount as big-endian bytes for WalletCore's Cardano proto. */
const amountToBytes = (amount: bigint): Uint8Array => {
  const hex = amount.toString(16)
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`
  return Uint8Array.from(Buffer.from(padded, 'hex'))
}

export const getCardanoSigningInputs: SigningInputsResolver<'cardano'> = ({
  keysignPayload,
  walletCore,
}) => {
  const { sendMaxAmount, ttl, byteFee } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'cardano'
  )

  const coin = shouldBePresent(keysignPayload.coin)
  const isTokenSend = coin.contractAddress !== ''

  const tokenBundle = isTokenSend
    ? (() => {
        const { policyId, assetName } = fromCardanoAssetId(
          coin.contractAddress
        )

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

  // `transferMessage.amount` is the lovelace value of the recipient output.
  // For an ADA send it's the user-typed amount. For a CNT send the user-typed
  // amount is denominated in the token's base units (e.g. 665000 = 0.665 USDM),
  // NOT lovelace — passing it here produces an output below Cardano's per-
  // output min-UTxO floor and the network rejects with code 3125.
  const recipientLovelace = isTokenSend
    ? minLovelaceOnTokenOutput
    : BigInt(keysignPayload.toAmount)

  const input = TW.Cardano.Proto.SigningInput.create({
    transferMessage: TW.Cardano.Proto.Transfer.create({
      toAddress: keysignPayload.toAddress,
      changeAddress: coin.address,
      amount: Long.fromString(recipientLovelace.toString()),
      // `useMaxAmount` is an ADA-only flag — when set, WalletCore's signer
      // drains every input lovelace into the recipient output (subtracting
      // fee). For CNT "Send Max" means "send all of the token" with the
      // lovelace floor fixed at min-UTxO; never set this for token sends.
      useMaxAmount: isTokenSend ? false : sendMaxAmount,
      tokenAmount: tokenBundle,
      forceFee: Long.fromString(byteFee.toString()),
    }),
    ttl: Long.fromString(ttl.toString()),

    // Per-UTXO token data is carried on the wire (`UtxoInfo.cardano_tokens`).
    // The initiator fetches once from Koios when building the keysign payload
    // and serialises the assets into the proto; both MPC peers read identical
    // bytes here, so `AnySigner.plan(...)` picks the same selection on both
    // sides (largest-first deterministic — see WalletCore Cardano/Signer.cpp
    // `selectInputsSimpleNative` / `selectInputsSimpleToken`).
    utxos: keysignPayload.utxoInfo.map(({ hash, amount, index, cardanoTokens }) => {
      const tokenAmounts =
        isTokenSend && cardanoTokens.length > 0
          ? cardanoTokens.map(asset =>
              TW.Cardano.Proto.TokenAmount.create({
                policyId: asset.policyId,
                assetNameHex: asset.assetNameHex,
                amount: amountToBytes(BigInt(asset.amount)),
              })
            )
          : undefined

      return TW.Cardano.Proto.TxInput.create({
        outPoint: TW.Cardano.Proto.OutPoint.create({
          txHash: walletCore.HexCoding.decode(stripHexPrefix(hash)),
          outputIndex: Long.fromString(index.toString()),
        }),
        amount: Long.fromString(amount.toString()),
        address: coin.address,
        ...(tokenAmounts ? { tokenAmount: tokenAmounts } : {}),
      })
    }),
  })

  // Run AnySigner.plan() with the now-token-aware inputs. Without `input.plan`
  // set, WalletCore's signer reads the body's fee from `plan.fee` (Signer.cpp:80
  // `tx.fee = plan.fee`) and `forceFee` on the Transfer message is only
  // consulted INSIDE doPlan() (Signer.cpp:551-555) — meaning a missing plan
  // produces a body with `fee = 0` regardless of `forceFee`.
  const inputBytes = TW.Cardano.Proto.SigningInput.encode(input).finish()
  const planBytes = walletCore.AnySigner.plan(inputBytes, walletCore.CoinType.cardano)
  const plan = TW.Cardano.Proto.TransactionPlan.decode(planBytes)
  if (plan.error !== TW.Common.Proto.SigningError.OK) {
    throw new Error(`Cardano plan error: ${plan.error}`)
  }
  input.plan = plan
  if (input.transferMessage) {
    input.transferMessage.forceFee = plan.fee
  }

  return [input]
}
