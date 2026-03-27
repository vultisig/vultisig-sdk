import { Chain, EvmChain, UtxoChain } from '@vultisig/core-chain/Chain'
import { DeriveChainKind } from '@vultisig/core-chain/ChainKind'
import { UtxoFeeSettings } from '@vultisig/core-chain/tx/fee/utxo/UtxoFeeSettings'

export const feeSettingsChains = [
  ...Object.values(EvmChain),
  ...Object.values(UtxoChain),
] as const satisfies Chain[]

export type FeeSettingsChain = (typeof feeSettingsChains)[number]

export type FeeSettingsChainKind = DeriveChainKind<FeeSettingsChain>

export type EvmFeeSettings = {
  maxPriorityFeePerGas: bigint
  gasLimit: bigint
}

export type FeeSettings<T extends FeeSettingsChainKind = FeeSettingsChainKind> =
  T extends 'evm' ? EvmFeeSettings : UtxoFeeSettings
