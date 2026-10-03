import { getMaxSendableAmount, getSendRetainedBalance } from '@vultisig/core-chain/amount/getMaxSendableAmount'
import { Chain, CosmosChain, UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { isTerraClassicUstcCoin } from '@vultisig/core-chain/chains/cosmos/terraClassicTax'
import { getNearSendLimits } from '@vultisig/core-chain/chains/near/sendLimits'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { minBigInt } from '@vultisig/lib-utils/math/minBigInt'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { TransactionType } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { BuildKeysignPayloadError } from '../error'
import { getFeeAmount } from '../fee'
import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'
import { getNearSendRequiredAmount } from '@vultisig/core-chain/chains/near/fees'
import { getCosmosChainSpecific } from '../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignCoin } from '../utils/getKeysignCoin'

type RefineKeysignAmountInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  publicKey: PublicKey
  balance: bigint
}

export const refineKeysignAmount = async (input: RefineKeysignAmountInput) => {
  if (!input.keysignPayload.toAmount || input.keysignPayload.toAmount === '0') {
    return input.keysignPayload
  }

  const coin = getKeysignCoin(input.keysignPayload)
  // TerraClassic USTC pays its fee (base gas + burn tax) in `uusd` — the same
  // denom being sent — so a full-balance USTC send must be refined down just
  // like a native-fee-coin send. Every other non-fee-coin token pays gas from
  // a separate native balance and is left untouched.
  //
  // Scoped to PLAIN bank sends only (mirrors `getCosmosChainSpecific`'s
  // `isPlainSend` gate and the signing-inputs resolver's own `isPlainSend`
  // check): an IBC transfer of USTC still prices `CosmosSpecific.gas` in
  // `uluna`, so refining `uusd` here for an IBC send would debit a denom the
  // signing path never priced against — a real refine/sign mismatch.
  const isTerraClassicUstcPlainSend =
    isTerraClassicUstcCoin(coin) &&
    matchRecordUnion(getCosmosChainSpecific(coin.chain as CosmosChain, input.keysignPayload.blockchainSpecific), {
      ibcEnabled: ({ transactionType }) => transactionType === TransactionType.UNSPECIFIED,
      vaultBased: () => false,
    })

  if (!isFeeCoin(coin) && !isTerraClassicUstcPlainSend) {
    return input.keysignPayload
  }

  if (isOneOf(coin.chain, Object.values(UtxoBasedChain)) || coin.chain === Chain.Ton) {
    return input.keysignPayload
  }

  // NEAR is charged upfront for the amount *plus* the gas reservation, and an
  // account must keep backing its own storage. Clamping the amount down to
  // whatever fits (the shared behaviour below) would sign a smaller transfer
  // than the user asked for, so an unaffordable NEAR send fails instead. MAX is
  // the one flow that may reduce, and it reduces explicitly by passing the
  // already-reduced amount.
  if (coin.chain === Chain.Near) {
    const { gasFee } = getBlockchainSpecificValue(input.keysignPayload.blockchainSpecific, 'nearSpecific')
    const { storageReserve } = await getNearSendLimits({
      address: coin.address,
      receiver: input.keysignPayload.toAddress,
    })

    const required = getNearSendRequiredAmount({
      requestedAmount: BigInt(input.keysignPayload.toAmount),
      gasReservation: BigInt(gasFee),
      storageReserve,
    })

    if (required > input.balance) {
      throw new BuildKeysignPayloadError(
        'not-enough-funds',
        `NEAR send needs ${required} yoctoNEAR (amount + gas reservation + storage reserve) but only ${input.balance} is available`,
        { required, available: input.balance, ticker: coin.ticker, decimals: coin.decimals, includesNetworkCosts: true }
      )
    }

    return input.keysignPayload
  }

  const fee = await getFeeAmount(input)

  // Clamps to what the sender may actually part with: the balance less the fee
  // and, on chains that reap emptied accounts, the existential deposit — so a
  // MAX send quoted as `balance - fee` cannot fail a keep-alive transfer. A
  // payload that explicitly allows death is meant to empty the account and
  // keeps nothing back.
  const { blockchainSpecific } = input.keysignPayload
  const allowDeath = blockchainSpecific.case === 'polkadotSpecific' && blockchainSpecific.value.allowDeath
  const refinedAmount = minBigInt(
    BigInt(input.keysignPayload.toAmount),
    getMaxSendableAmount({ chain: coin.chain, balance: input.balance, fee, allowDeath })
  )

  if (refinedAmount <= 0n) {
    throw new BuildKeysignPayloadError('not-enough-funds', undefined, {
      required: BigInt(input.keysignPayload.toAmount) + fee + getSendRetainedBalance(coin.chain, allowDeath),
      available: input.balance,
      ticker: coin.ticker,
      decimals: coin.decimals,
      includesNetworkCosts: true,
    })
  }

  return {
    ...input.keysignPayload,
    toAmount: refinedAmount.toString(),
  }
}
