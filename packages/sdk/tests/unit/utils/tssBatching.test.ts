import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import type { SdkConfigOptions } from '../../../src/context/SdkContext'
import {
  DEFAULT_TSS_BATCHING,
  getChainBatchMessageIds,
  resolveTssBatching,
  TSS_BATCH_MESSAGE_IDS,
} from '../../../src/utils/tssBatching'

describe('tssBatching utils', () => {
  describe('TSS_BATCH_MESSAGE_IDS', () => {
    it('uses stable relay message ids for global batch ceremonies', () => {
      expect(TSS_BATCH_MESSAGE_IDS).toEqual({
        ecdsa: 'p-ecdsa',
        eddsa: 'p-eddsa',
        mldsa: 'p-mldsa',
        mldsaSetup: 'p-mldsa-setup',
        eddsaImportSetup: 'eddsa_key_import',
      })
    })
  })

  describe('getChainBatchMessageIds', () => {
    it('splits setup vs protocol ids per chain for parallel import', () => {
      expect(getChainBatchMessageIds(Chain.Ethereum)).toEqual({
        setupMessageId: Chain.Ethereum,
        protocolMessageId: 'p-Ethereum',
      })
    })
  })

  describe('resolveTssBatching', () => {
    const baseConfig = {} as Readonly<SdkConfigOptions>

    it('defaults to DEFAULT_TSS_BATCHING when unset', () => {
      expect(resolveTssBatching(baseConfig)).toBe(DEFAULT_TSS_BATCHING)
      expect(DEFAULT_TSS_BATCHING).toBe(false)
    })

    it('uses SdkConfigOptions.tssBatching when no override', () => {
      expect(resolveTssBatching({ ...baseConfig, tssBatching: true })).toBe(true)
      expect(resolveTssBatching({ ...baseConfig, tssBatching: false })).toBe(false)
    })

    it('override wins over config', () => {
      expect(resolveTssBatching({ ...baseConfig, tssBatching: false }, true)).toBe(true)
      expect(resolveTssBatching({ ...baseConfig, tssBatching: true }, false)).toBe(false)
    })
  })
})
