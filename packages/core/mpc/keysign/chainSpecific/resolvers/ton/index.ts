import { create } from '@bufbuild/protobuf'
import { getTonAccountInfo } from '@vultisig/core-chain/chains/ton/account/getTonAccountInfo'
import { getTonAddressBounceability } from '@vultisig/core-chain/chains/ton/address'
import { getJettonWalletAddress, getTonWalletState } from '@vultisig/core-chain/chains/ton/api'
import { TonSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { attempt } from '@vultisig/lib-utils/attempt'

import { getKeysignSwapPayload } from '../../../swap/getKeysignSwapPayload'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'

const tonWalletStateUninitialized = 'uninit'

/** How long a wallet message stays valid when the caller sets no tighter deadline. */
const tonWalletExpirySeconds = 600

type ResolveTonExpireAtInput = {
  now: number
  validUntil?: number
}

/**
 * The `expireAt` to sign. The wallet's own 10-minute window is the ceiling; a dApp
 * deadline (`valid_until`) can only tighten it, never extend it. A deadline that has
 * already passed by build time fails here rather than producing a transaction the
 * network will reject.
 */
const resolveTonExpireAt = ({ now, validUntil }: ResolveTonExpireAtInput): number => {
  const walletDeadline = now + tonWalletExpirySeconds
  if (validUntil === undefined) {
    return walletDeadline
  }

  // Whole seconds only: flooring first means a deadline less than a second out is
  // caught here rather than signed as an expiry equal to `now`.
  const deadline = Number.isFinite(validUntil) ? Math.floor(validUntil) : Number.NaN
  if (!(deadline > now)) {
    throw new Error(`TON request deadline (valid_until ${validUntil}) has already passed`)
  }

  return Math.min(walletDeadline, deadline)
}

/**
 * Resolves the TON-specific keysign fields: the sender's seqno, an expiry, whether the
 * transfer bounces on rejection, and — for Jettons — the sender's Jetton wallet and
 * whether the destination is deployed. `sendMaxAmount` is recorded from the caller
 * rather than inferred, so an ordinary send that happens to sit close to the balance is
 * not relabelled a MAX send.
 */
export const getTonChainSpecific: GetChainSpecificResolver<'tonSpecific'> = async ({
  keysignPayload,
  sendMaxAmount = false,
  validUntil,
}) => {
  const coin = getKeysignCoin(keysignPayload)
  const { address } = coin
  const receiver = keysignPayload.toAddress

  // Read seqno defensively. A TON wallet that has RECEIVED funds but never SENT
  // is still UNINITIALIZED (its contract deploys on the first outgoing tx via
  // StateInit); getExtendedAddressInformation returns an `uninited.accountState`
  // result with NO `seqno` field, so `account_state.seqno` on the raw result is
  // undefined — optional-chain to seqno 0 (the signing path then correctly
  // attaches StateInit for seqno === 0), matching the abts side's
  // `?.account_state?.seqno ?? 0`. A genuine RPC failure (`{ ok:false }`) is now
  // caught inside `getTonAccountInfo`, which throws a descriptive error rather
  // than returning null and crashing this destructure.
  const { account_state } = await getTonAccountInfo(address)
  const sequenceNumber = BigInt(account_state?.seqno ?? 0)

  // Whether the transfer goes out bounceable, which decides what happens to the funds
  // when the destination rejects the message: a bounceable transfer is refunded, a
  // non-bounceable one is absorbed by the destination and gone.
  const getIsBounceable = async () => {
    if (!receiver) {
      return false
    }

    // A swap deposit lands on a router or escrow contract, and there are ordinary
    // reasons for such a contract to reject: an expired quote, a paused pool, a
    // route that closed between quote and broadcast. Those have to come back.
    if (getKeysignSwapPayload(keysignPayload)) {
      return true
    }

    // An undeployed account has no code to reject anything, so a bounceable message
    // is simply returned and the transfer never lands. Those must go non-bounceable.
    const { data: walletState } = await attempt(getTonWalletState(receiver))
    if (walletState === tonWalletStateUninitialized) {
      return false
    }

    // A raw `0:hex` destination declares no intent, so it defaults to bounceable —
    // the safe side for anything that might be a contract. Only an explicit `UQ…`
    // opts out.
    return getTonAddressBounceability(receiver) !== 'nonBounceable'
  }

  const result = create(TonSpecificSchema, {
    sequenceNumber,
    expireAt: BigInt(resolveTonExpireAt({ now: Math.floor(Date.now() / 1000), validUntil })),
    bounceable: await getIsBounceable(),
    sendMaxAmount,
    jettonAddress: '',
    isActiveDestination: false,
  })

  if (coin.id) {
    // A Jetton transfer is a message to the SENDER's own jetton wallet, so without
    // that address there is no transaction to build. Leaving the empty-string default
    // in place does not stop anything downstream — the signing path's presence check
    // only rejects null/undefined — so a failed lookup would otherwise be signed as a
    // transfer to nowhere. This lookup fails transiently (RPC timeout, indexer lag),
    // so it stays a plain retryable Error rather than a BuildKeysignPayloadError.
    const jettonWallet = await attempt(
      getJettonWalletAddress({
        ownerAddress: address,
        jettonMasterAddress: coin.id,
      })
    )

    if ('error' in jettonWallet || !jettonWallet.data.trim()) {
      throw new Error(
        `Unable to resolve the ${coin.ticker} jetton wallet owned by ${address}. ` +
          'Refusing to build a Jetton transfer without it.',
        'error' in jettonWallet ? { cause: jettonWallet.error } : undefined
      )
    }

    result.jettonAddress = jettonWallet.data

    if (receiver) {
      const { data: destWalletState } = await attempt(getTonWalletState(receiver))
      result.isActiveDestination = destWalletState !== tonWalletStateUninitialized
    }
  }

  return result
}
