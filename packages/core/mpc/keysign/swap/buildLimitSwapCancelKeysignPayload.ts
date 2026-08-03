import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { areEqualCoins } from '@vultisig/core-chain/coin/Coin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { getLimitSwapCancelDust } from '@vultisig/core-chain/swap/native/limitSwapCancelDust'
import {
  doesCancelLimitSwapMemoFit,
  isCancelLimitSwapMemo,
  isModifyLimitSwapMemo,
} from '@vultisig/core-chain/swap/native/limitSwapCancelMemo'
import { findLimitSwapInbound, shouldBlockRuneDeposit } from '@vultisig/core-chain/swap/native/limitSwapInbound'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { getChainSpecific } from '../chainSpecific'
import { refineKeysignUtxo } from '../refine/utxo'
import { getKeysignUtxoInfo } from '../utxo/getKeysignUtxoInfo'
import { KeysignLibType } from '../../mpcLib'
import { toCommCoin } from '../../types/utils/commCoin'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'

export type BuildLimitSwapCancelKeysignPayloadInput = {
  /**
   * The gas asset of the chain the order was FUNDED FROM — never the order's own
   * asset. A cancel moves no tokens: it is a memo, carried by whatever the source
   * chain charges to carry one. A BTC-funded order cancels with BTC; an
   * ERC20-funded one cancels with ETH, not with the token.
   */
  signingCoin: AccountCoin
  /** The `m=<` memo from `buildCancelLimitSwapMemo`. */
  memo: string
  vaultId: string
  localPartyId: string
  publicKey: PublicKey
  libType: KeysignLibType
  walletCore: WalletCore
}

/**
 * Build the `KeysignPayload` that cancels a resting THORChain limit order.
 *
 * Two branches, decided by where the order was funded:
 *
 * - **THORChain source** (RUNE, and THORChain-held assets) — `MsgDeposit` from
 *   the vault's own THOR address. No inbound vault and no real destination, so
 *   `toAddress` carries the signer's own address as a placeholder (the Cosmos
 *   signer keys off `isDeposit`, not `toAddress`) and no value is attached.
 * - **L1 source** — a plain transfer to the chain's Asgard inbound vault with the
 *   memo attached. The amount is dust from `getLimitSwapCancelDust`, present
 *   solely so Bifrost observes the transaction; it is not a payment, and the
 *   router is deliberately not involved even for an ERC20-funded order, because
 *   `depositWithExpiry` exists to move tokens and a cancel moves none.
 *
 * Fund-safety gates, all fail-closed — a cancel that is accepted but matches
 * nothing is indistinguishable from success, so every unknown refuses:
 *
 * - The memo must actually CANCEL. `m=<` with a non-zero final field re-prices a
 *   resting order instead of closing it, and must not be signed by a function
 *   whose callers believe they are cancelling.
 * - The memo must fit the source chain's per-transaction budget. A cancel cannot
 *   be shortened — its amounts define the bucket and its assets skip
 *   `fuzzyAssetMatch` — so an over-long one has to be refused here rather than
 *   silently truncated into a memo addressing nothing.
 * - A THORChain-sourced cancel is blocked on THORChain's global trading pause,
 *   including when the inbound list is unverifiable, exactly as placement is.
 * - An L1 cancel must resolve a live, non-halted, non-paused inbound, and takes
 *   its destination from that same live view rather than a cache. A cancel sent
 *   to a churned-away vault is as lost as a placement would be.
 *
 * Note what is NOT gated: the `EnableAdvSwapQueue` mimir, which placement does
 * re-check at sign time. That gate protects a NEW `=<` order from executing as an
 * unprotected market swap — a risk a cancel does not carry. Refusing to close an
 * already-resting order because the queue stopped accepting new ones would strand
 * a position for the remainder of its TTL with no way out, which is the worse
 * failure of the two.
 */
export const buildLimitSwapCancelKeysignPayload = async ({
  signingCoin,
  memo,
  vaultId,
  localPartyId,
  publicKey,
  libType,
  walletCore,
}: BuildLimitSwapCancelKeysignPayloadInput) => {
  if (!isCancelLimitSwapMemo(memo)) {
    throw new Error(
      isModifyLimitSwapMemo(memo)
        ? `buildLimitSwapCancelKeysignPayload: memo re-targets a limit order rather than cancelling it: ${JSON.stringify(memo)}`
        : `buildLimitSwapCancelKeysignPayload: memo is not a THORChain limit-order cancel: ${JSON.stringify(memo)}`
    )
  }

  // Both branches spend gas and move nothing, so a token here means the caller
  // passed the order's own asset rather than the funding chain's gas asset —
  // which on an EVM chain would build an ERC20 transfer that drops the memo.
  if (!isFeeCoin(signingCoin)) {
    throw new Error(
      `buildLimitSwapCancelKeysignPayload: a cancel must be signed with ${signingCoin.chain}'s gas asset, got ${signingCoin.ticker}`
    )
  }

  const isThorchainSource = areEqualCoins(signingCoin, chainFeeCoin[Chain.THORChain])

  if (!doesCancelLimitSwapMemoFit(memo, isChainOfKind(signingCoin.chain, 'utxo') ? 'utxo' : 'other')) {
    throw new Error(
      `buildLimitSwapCancelKeysignPayload: the cancel memo does not fit ${signingCoin.chain}'s memo budget: ${JSON.stringify(memo)}`
    )
  }

  const hexPublicKey = Buffer.from(publicKey.data()).toString('hex')
  const inbounds = await getThorchainInboundAddress()

  const { toAddress, amount } = ((): { toAddress: string; amount: bigint } => {
    if (isThorchainSource) {
      if (shouldBlockRuneDeposit(inbounds)) {
        throw new Error(
          'THORChain has globally paused trading (or its inbound list is unverifiable); refusing to sign a limit-order cancel'
        )
      }

      // A MsgDeposit carries no value for a cancel — the memo is the whole
      // instruction — and the Cosmos signer routes on `isDeposit`, not on this
      // address.
      return { toAddress: signingCoin.address, amount: 0n }
    }

    const inbound = findLimitSwapInbound({ inbounds, chain: signingCoin.chain })

    return {
      toAddress: inbound.address,
      amount: getLimitSwapCancelDust({ inbound, decimals: signingCoin.decimals }),
    }
  })()

  let keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({ ...signingCoin, hexPublicKey }),
    toAmount: amount.toString(),
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    toAddress,
    memo,
    utxoInfo: await getKeysignUtxoInfo(signingCoin),
  })

  keysignPayload.blockchainSpecific = await getChainSpecific({
    keysignPayload,
    walletCore,
    isDeposit: isThorchainSource,
  })

  if (isChainOfKind(signingCoin.chain, 'utxo')) {
    keysignPayload = await refineKeysignUtxo({
      keysignPayload,
      walletCore,
      publicKey,
    })
  }

  return keysignPayload
}
