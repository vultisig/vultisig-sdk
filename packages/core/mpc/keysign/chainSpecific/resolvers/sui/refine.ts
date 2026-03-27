import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { suiMinGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { SuiSpecific } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import {
  KeysignPayload,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { maxBigInt } from '@vultisig/lib-utils/math/maxBigInt'
import { WalletCore } from '@trustwallet/wallet-core'

import { getPreSigningOutput } from '../../../preSigningOutput'
import { getEncodedSigningInputs } from '../../../signingInputs'

const gasBudgetMultiplier = (value: bigint) => (value * 115n) / 100n

type RefineSuiChainSpecificInput = {
  keysignPayload: KeysignPayload
  chainSpecific: SuiSpecific
  walletCore: WalletCore
}

export const refineSuiChainSpecific = async ({
  keysignPayload,
  chainSpecific,
  walletCore,
}: RefineSuiChainSpecificInput): Promise<SuiSpecific> => {
  const client = getSuiClient()

  const [txInputData] = getEncodedSigningInputs({
    keysignPayload: create(KeysignPayloadSchema, {
      ...keysignPayload,
      blockchainSpecific: {
        case: 'suicheSpecific',
        value: chainSpecific,
      },
    }),
    walletCore,
  })

  const { data } = getPreSigningOutput({
    walletCore,
    txInputData,
    chain: Chain.Sui,
  })

  const txBytes = Buffer.from(data).subarray(3).toString('base64')

  const {
    effects: {
      gasUsed: { computationCost, storageCost },
    },
  } = await client.dryRunTransactionBlock({
    transactionBlock: txBytes,
  })

  const gasBudget = BigInt(computationCost) + BigInt(storageCost)

  return {
    ...chainSpecific,
    gasBudget: maxBigInt(
      gasBudgetMultiplier(gasBudget),
      suiMinGasBudget
    ).toString(),
  }
}
