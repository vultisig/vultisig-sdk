import { Chain, CosmosChain, UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { isTerraClassicUstcCoin } from '@vultisig/core-chain/chains/cosmos/terraClassicTax'
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
import { getCosmosChainSpecific } from '../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignCoin } from '../utils/getKeysignCoin'

type RefineKeysignAmountInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  /** Not read by any fee resolver (they derive from `keysignPayload.coin.hexPublicKey`); accepted as null for the `hexPublicKeyOverride` signing path. */
  publicKey: PublicKey | null
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

  const fee = await getFeeAmount(input)

  const refinedAmount = minBigInt(BigInt(input.keysignPayload.toAmount), input.balance - fee)

  if (refinedAmount <= 0n) {
    throw new BuildKeysignPayloadError('not-enough-funds')
  }

  return {
    ...input.keysignPayload,
    toAmount: refinedAmount.toString(),
  }
}
