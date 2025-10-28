import { ChainKind } from '../../ChainKind'
import { EvmFeeSettings } from '../../tx/fee/evm/EvmFeeSettings'
import { UtxoFeeSettings } from '../../tx/fee/utxo/UtxoFeeSettings'

export const feeSettingsChainKinds = [
  'evm',
  'utxo',
] as const satisfies ChainKind[]

export type FeeSettingsChainKind = (typeof feeSettingsChainKinds)[number]

export type FeeSettings<T extends FeeSettingsChainKind = FeeSettingsChainKind> =
  T extends 'evm' ? EvmFeeSettings : UtxoFeeSettings
