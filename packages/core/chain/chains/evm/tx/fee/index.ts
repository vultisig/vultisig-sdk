import { EvmChain } from '../../../../Chain'

export type EvmTxFeeFormat = 'enveloped' | 'legacy'

export const evmChainTxFeeFormat: Record<EvmChain, EvmTxFeeFormat> = {
  [EvmChain.Arbitrum]: 'enveloped',
  [EvmChain.Base]: 'enveloped',
  [EvmChain.Blast]: 'enveloped',
  [EvmChain.Optimism]: 'enveloped',
  [EvmChain.Zksync]: 'enveloped',
  [EvmChain.Avalanche]: 'enveloped',
  [EvmChain.CronosChain]: 'enveloped',
  [EvmChain.BSC]: 'legacy',
  [EvmChain.Ethereum]: 'enveloped',
  [EvmChain.Polygon]: 'enveloped',
  [EvmChain.Mantle]: 'enveloped',
  [EvmChain.Hyperliquid]: 'enveloped',
  // Sei must stay 'enveloped': iOS (EVMHelper.setGasParameters) and Android
  // (EthereumGasHelper.setGasParameters) sign every EVM chain except BSC as
  // EIP-1559. A different tx mode changes the pre-signing hash and therefore
  // the relay message_id, so extension<->mobile Sei co-signing deadlocks
  // (vultisig-windows#4369).
  [EvmChain.Sei]: 'enveloped',
  [EvmChain.Robinhood]: 'enveloped',
}
