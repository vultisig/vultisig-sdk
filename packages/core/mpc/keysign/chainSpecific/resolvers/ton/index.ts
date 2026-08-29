import { create } from '@bufbuild/protobuf'
import { getTonAccountInfo } from '@vultisig/core-chain/chains/ton/account/getTonAccountInfo'
import { getTonAddressBounceability } from '@vultisig/core-chain/chains/ton/address'
import { getJettonWalletAddress, getTonWalletState } from '@vultisig/core-chain/chains/ton/api'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { TonSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { attempt } from '@vultisig/lib-utils/attempt'

import { getTonFeeAmount } from '../../../fee/resolvers/ton'
import { getKeysignSwapPayload } from '../../../swap/getKeysignSwapPayload'
import { getKeysignAmount } from '../../../utils/getKeysignAmount'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'

const tonWalletStateUninitialized = 'uninit'

/**
 * Resolves the TON-specific keysign fields: the sender's seqno, an expiry, whether the
 * transfer bounces on rejection, whether it sweeps the balance, and — for Jettons — the
 * sender's Jetton wallet and whether the destination is deployed.
 */
export const getTonChainSpecific: GetChainSpecificResolver<'tonSpecific'> = async ({ keysignPayload }) => {
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

  const getSendMaxAmount = async () => {
    if (coin.id) return false

    const amount = getKeysignAmount(keysignPayload)
    if (!amount) return false

    const balance = await getCoinBalance(coin)
    const fee = getTonFeeAmount(coin)

    return amount + fee >= balance
  }

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
    expireAt: BigInt(Math.floor(Date.now() / 1000) + 600),
    bounceable: await getIsBounceable(),
    sendMaxAmount: await getSendMaxAmount(),
    jettonAddress: '',
    isActiveDestination: false,
  })

  if (coin.id) {
    const { data: jettonWallet } = await attempt(
      getJettonWalletAddress({
        ownerAddress: address,
        jettonMasterAddress: coin.id,
      })
    )

    if (jettonWallet) {
      result.jettonAddress = jettonWallet
    }

    if (receiver) {
      const { data: destWalletState } = await attempt(getTonWalletState(receiver))
      result.isActiveDestination = destWalletState !== tonWalletStateUninitialized
    }
  }

  return result
}