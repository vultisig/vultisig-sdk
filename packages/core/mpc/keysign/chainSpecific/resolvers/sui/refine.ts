import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { suiMinGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { getSuiResultTransaction } from '@vultisig/core-chain/chains/sui/transactionResult'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { SuiSpecific } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
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

  const [txInputData] = await getEncodedSigningInputs({
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

  // Strip WalletCore's 3-byte intent prefix — the chain wants the raw
  // TransactionData BCS bytes. `simulateTransaction` (the replacement for the
  // retired `dryRunTransactionBlock`) takes those bytes directly rather than a
  // base64 string.
  const txBytes = new Uint8Array(Buffer.from(data).subarray(3))

  const simulation = await client.simulateTransaction({
    transaction: txBytes,
    include: { effects: true },
  })

  // A simulation that reports no gas at all cannot price the budget; fail
  // closed rather than fall through to a 0 budget the send can't pay for.
  const gasUsed = shouldBePresent(getSuiResultTransaction(simulation)?.effects?.gasUsed, 'Sui simulated gas usage')

  const gasBudget = BigInt(gasUsed.computationCost ?? '0') + BigInt(gasUsed.storageCost ?? '0')

  return {
    ...chainSpecific,
    gasBudget: maxBigInt(gasBudgetMultiplier(gasBudget), suiMinGasBudget).toString(),
  }
}
