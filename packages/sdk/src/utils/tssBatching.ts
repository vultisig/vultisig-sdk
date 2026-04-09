import type { Chain } from '@vultisig/core-chain/Chain'

import type { SdkConfigOptions } from '../context/SdkContext'

export const DEFAULT_TSS_BATCHING = false

export const TSS_BATCH_MESSAGE_IDS = {
  ecdsa: 'p-ecdsa',
  eddsa: 'p-eddsa',
  mldsa: 'p-mldsa',
  mldsaSetup: 'p-mldsa-setup',
  eddsaImportSetup: 'eddsa_key_import',
} as const

export const getChainBatchMessageIds = (chain: Chain) => ({
  setupMessageId: chain,
  protocolMessageId: `p-${chain}`,
})

export const resolveTssBatching = (config: Readonly<SdkConfigOptions>, override?: boolean): boolean =>
  override ?? config.tssBatching ?? DEFAULT_TSS_BATCHING
