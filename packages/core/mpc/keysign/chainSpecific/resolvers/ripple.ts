import { create } from '@bufbuild/protobuf'
import { getRippleAccountInfo } from '@vultisig/core-chain/chains/ripple/account/info'
import { getRippleNetworkInfo } from '@vultisig/core-chain/chains/ripple/network/info'
import { RippleSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { maxBigInt } from '@vultisig/lib-utils/math/maxBigInt'

import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../resolver'

const minProtocolFee = 15n
const baseFeeMultiplier = 2n

export const getRippleChainSpecific: GetChainSpecificResolver<'rippleSpecific'> = async ({ keysignPayload }) => {
  const { address } = getKeysignCoin(keysignPayload)

  // A dApp-supplied transaction (OfferCreate, OfferCancel, …) carries no
  // `toAddress`: the base-reserve check below is specific to a Payment that
  // funds a destination, so skip the destination fetch when there isn't one.
  // Fee and sequence come from the sender account and are unaffected.
  const toAddress = keysignPayload.toAddress || undefined

  const [senderAccount, networkInfo, destinationAccountResult] = await Promise.all([
    getRippleAccountInfo(address),
    getRippleNetworkInfo(),
    toAddress ? attempt(getRippleAccountInfo(toAddress)) : undefined,
  ])

  const { validated_ledger, load_factor, load_base } = networkInfo
  const { base_fee, reserve_base } = shouldBePresent(validated_ledger)

  const computedFee = ((BigInt(base_fee) * BigInt(load_factor)) / BigInt(load_base)) * baseFeeMultiplier

  const networkFee = maxBigInt(computedFee, minProtocolFee)

  // XRPL base reserve is a requirement on the Payment AMOUNT (the drops that
  // fund/activate the destination account), NOT on the Fee. The Fee is BURNED
  // by the network — it never reaches the recipient. The previous code added
  // reserve_base to `gas` (which becomes TW.Ripple SigningInput.fee), so every
  // send to a not-yet-activated XRP address burned ~1 XRP (the reserve) for
  // nothing, on top of the actual send amount. Reserve spec:
  // https://xrpl.org/docs/concepts/accounts/reserves
  const destinationUnfunded =
    destinationAccountResult !== undefined &&
    'error' in destinationAccountResult &&
    isInError(destinationAccountResult.error, 'Account not found')

  if (destinationUnfunded) {
    const toAmount = BigInt(shouldBePresent(keysignPayload.toAmount))
    if (toAmount < BigInt(reserve_base)) {
      throw new Error(
        `Cannot send to XRP account ${toAddress}: it is not yet activated, and XRPL requires the ` +
          `Payment amount to be at least the base reserve (${reserve_base} drops) to create a new ` +
          `account. The send amount is ${toAmount.toString()} drops. Increase the amount to at least ` +
          `the reserve, or send to an already-activated account.`
      )
    }
  }

  const { account_data, ledger_current_index } = senderAccount

  return create(RippleSpecificSchema, {
    sequence: BigInt(account_data.Sequence),
    lastLedgerSequence: BigInt((ledger_current_index ?? 0) + 60),
    // Fee is the network fee only — the reserve rides on the Payment amount.
    gas: networkFee,
  })
}
