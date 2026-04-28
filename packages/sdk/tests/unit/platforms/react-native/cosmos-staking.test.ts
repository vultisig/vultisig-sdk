/**
 * Cosmos staking module builder tests.
 *
 * Strategy: hand-rolled protobuf in tx.ts is the unit-under-test. We re-decode
 * its output using cosmjs-types (the canonical reference encoder, test-only
 * dep, NOT used in RN runtime) and assert the round-trip. This catches any
 * encoding drift between our hand-rolled bytes and the protocol-canonical
 * ones, which is the byte-for-byte correctness invariant we want from the
 * SDK before any consumer signs and broadcasts.
 *
 * Covers:
 *   - MsgDelegate / MsgUndelegate (identical wire shape)
 *   - MsgBeginRedelegate (4-field, the only one with two valoper addrs)
 *   - MsgWithdrawDelegatorReward (no Coin)
 *   - Multi-msg batched tx (e.g. withdraw rewards from many validators)
 *   - Empty msgs[] guard
 */
import { MsgWithdrawDelegatorReward } from 'cosmjs-types/cosmos/distribution/v1beta1/tx'
import { MsgBeginRedelegate, MsgDelegate, MsgUndelegate } from 'cosmjs-types/cosmos/staking/v1beta1/tx'
import { TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { describe, expect, it } from 'vitest'

import {
  type BuildCosmosStakingOptions,
  buildCosmosStakingTx,
  COSMOS_STAKING_TYPE_URLS,
  type CosmosStakingMsg,
} from '../../../../src/platforms/react-native/chains/cosmos/tx'

// Realistic-looking bech32 strings. Validity isn't enforced by the encoder
// (addresses are passed through as opaque strings into proto field 1/2/3),
// but using realistic shapes makes test failures easier to read.
const FX = {
  chainId: 'cosmoshub-4',
  delegator: 'cosmos1abcdefghijklmnopqrstuvwxyz0123456789ab',
  validator: 'cosmosvaloper1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzaaa',
  validatorSrc: 'cosmosvaloper1srcsrcsrcsrcsrcsrcsrcsrcsrcsrcsrcsrcs',
  validatorDst: 'cosmosvaloper1dstdstdstdstdstdstdstdstdstdstdstdsts',
  amount: '1000000',
  denom: 'uatom',
  feeAmount: '7500',
  gasLimit: 250_000,
  sequence: 42,
  accountNumber: 100,
  pubKey: new Uint8Array(33).fill(0x02),
}

function baseOpts(msgs: CosmosStakingMsg[]): BuildCosmosStakingOptions {
  return {
    chainId: FX.chainId,
    msgs,
    sequence: FX.sequence,
    accountNumber: FX.accountNumber,
    pubKeyBytes: FX.pubKey,
    gasLimit: FX.gasLimit,
    feeDenom: FX.denom,
    feeAmount: FX.feeAmount,
  }
}

describe('cosmos / buildCosmosStakingTx', () => {
  describe('MsgDelegate', () => {
    const msg: CosmosStakingMsg = {
      type: 'delegate',
      delegatorAddress: FX.delegator,
      validatorAddress: FX.validator,
      amount: FX.amount,
      denom: FX.denom,
    }

    it('produces a TxBody whose single Any has the canonical MsgDelegate typeUrl', () => {
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages).toHaveLength(1)
      expect(txBody.messages[0].typeUrl).toBe(COSMOS_STAKING_TYPE_URLS.delegate)
      expect(txBody.messages[0].typeUrl).toBe('/cosmos.staking.v1beta1.MsgDelegate')
    })

    it('encodes delegator/validator/amount fields that round-trip via cosmjs-types', () => {
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      const decoded = MsgDelegate.decode(txBody.messages[0].value)
      expect(decoded.delegatorAddress).toBe(FX.delegator)
      expect(decoded.validatorAddress).toBe(FX.validator)
      expect(decoded.amount).toEqual({ denom: FX.denom, amount: FX.amount })
    })

    it('produces a deterministic signing hash for identical inputs', () => {
      const a = buildCosmosStakingTx(baseOpts([msg]))
      const b = buildCosmosStakingTx(baseOpts([msg]))
      expect(a.signingHashHex).toBe(b.signingHashHex)
    })

    it('produces a different signing hash when the validator changes', () => {
      const a = buildCosmosStakingTx(baseOpts([msg]))
      const b = buildCosmosStakingTx(
        baseOpts([{ ...msg, validatorAddress: 'cosmosvaloper1otherotherotherotherotherotherother' }])
      )
      expect(a.signingHashHex).not.toBe(b.signingHashHex)
    })
  })

  describe('MsgUndelegate', () => {
    // MsgUndelegate has identical wire shape to MsgDelegate per cosmos-sdk
    // proto. The only difference is the Any typeUrl. Verify both halves.
    const msg: CosmosStakingMsg = {
      type: 'undelegate',
      delegatorAddress: FX.delegator,
      validatorAddress: FX.validator,
      amount: FX.amount,
      denom: FX.denom,
    }

    it('uses MsgUndelegate typeUrl, not MsgDelegate', () => {
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages[0].typeUrl).toBe('/cosmos.staking.v1beta1.MsgUndelegate')
    })

    it('round-trips via MsgUndelegate.decode', () => {
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      const decoded = MsgUndelegate.decode(txBody.messages[0].value)
      expect(decoded.delegatorAddress).toBe(FX.delegator)
      expect(decoded.validatorAddress).toBe(FX.validator)
      expect(decoded.amount).toEqual({ denom: FX.denom, amount: FX.amount })
    })
  })

  describe('MsgBeginRedelegate', () => {
    // The only delegation msg with two valoper addresses (src + dst). Easy
    // to forget in tests, called out as a gotcha in the native-app research.
    const msg: CosmosStakingMsg = {
      type: 'redelegate',
      delegatorAddress: FX.delegator,
      validatorSrcAddress: FX.validatorSrc,
      validatorDstAddress: FX.validatorDst,
      amount: FX.amount,
      denom: FX.denom,
    }

    it('encodes both src and dst validator addresses correctly', () => {
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages[0].typeUrl).toBe('/cosmos.staking.v1beta1.MsgBeginRedelegate')
      const decoded = MsgBeginRedelegate.decode(txBody.messages[0].value)
      expect(decoded.delegatorAddress).toBe(FX.delegator)
      expect(decoded.validatorSrcAddress).toBe(FX.validatorSrc)
      expect(decoded.validatorDstAddress).toBe(FX.validatorDst)
      expect(decoded.amount).toEqual({ denom: FX.denom, amount: FX.amount })
    })

    it('does NOT swap src and dst (regression guard)', () => {
      // Field 2 = src, field 3 = dst. A swap would silently produce a tx
      // that redelegates the wrong direction, draining the wrong validator.
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      const decoded = MsgBeginRedelegate.decode(txBody.messages[0].value)
      expect(decoded.validatorSrcAddress).not.toBe(decoded.validatorDstAddress)
      expect(decoded.validatorSrcAddress).toBe(FX.validatorSrc)
      expect(decoded.validatorDstAddress).toBe(FX.validatorDst)
    })
  })

  describe('MsgWithdrawDelegatorReward', () => {
    // No Coin field - just delegator + validator. Used in the canonical
    // "claim staking rewards" flow.
    const msg: CosmosStakingMsg = {
      type: 'withdraw_rewards',
      delegatorAddress: FX.delegator,
      validatorAddress: FX.validator,
    }

    it('uses the distribution-module typeUrl (not the staking one)', () => {
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages[0].typeUrl).toBe('/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward')
    })

    it('round-trips via MsgWithdrawDelegatorReward.decode', () => {
      const result = buildCosmosStakingTx(baseOpts([msg]))
      const txBody = TxBody.decode(result.txBodyBytes)
      const decoded = MsgWithdrawDelegatorReward.decode(txBody.messages[0].value)
      expect(decoded.delegatorAddress).toBe(FX.delegator)
      expect(decoded.validatorAddress).toBe(FX.validator)
    })
  })

  describe('multi-msg batch', () => {
    it('packs multiple withdraw_rewards msgs into a single TxBody preserving order', () => {
      const validators = [
        'cosmosvaloper1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'cosmosvaloper1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'cosmosvaloper1ccccccccccccccccccccccccccccccccccc',
      ]
      const msgs: CosmosStakingMsg[] = validators.map(v => ({
        type: 'withdraw_rewards',
        delegatorAddress: FX.delegator,
        validatorAddress: v,
      }))
      const result = buildCosmosStakingTx(baseOpts(msgs))
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages).toHaveLength(3)
      const decodedValidators = txBody.messages.map(m => MsgWithdrawDelegatorReward.decode(m.value).validatorAddress)
      expect(decodedValidators).toEqual(validators)
    })

    it('packs a delegate + withdraw_rewards combo (mixed types)', () => {
      const msgs: CosmosStakingMsg[] = [
        {
          type: 'delegate',
          delegatorAddress: FX.delegator,
          validatorAddress: FX.validator,
          amount: FX.amount,
          denom: FX.denom,
        },
        {
          type: 'withdraw_rewards',
          delegatorAddress: FX.delegator,
          validatorAddress: FX.validator,
        },
      ]
      const result = buildCosmosStakingTx(baseOpts(msgs))
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.messages.map(m => m.typeUrl)).toEqual([
        '/cosmos.staking.v1beta1.MsgDelegate',
        '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
      ])
    })
  })

  describe('memo', () => {
    it('round-trips through TxBody.memo when provided', () => {
      const result = buildCosmosStakingTx({
        ...baseOpts([
          {
            type: 'delegate',
            delegatorAddress: FX.delegator,
            validatorAddress: FX.validator,
            amount: FX.amount,
            denom: FX.denom,
          },
        ]),
        memo: 'claim airdrop via vultiagent',
      })
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.memo).toBe('claim airdrop via vultiagent')
    })

    it('emits empty memo by default', () => {
      const result = buildCosmosStakingTx(
        baseOpts([
          {
            type: 'delegate',
            delegatorAddress: FX.delegator,
            validatorAddress: FX.validator,
            amount: FX.amount,
            denom: FX.denom,
          },
        ])
      )
      const txBody = TxBody.decode(result.txBodyBytes)
      expect(txBody.memo).toBe('')
    })
  })

  describe('errors', () => {
    it('throws when msgs[] is empty', () => {
      expect(() => buildCosmosStakingTx(baseOpts([]))).toThrow(/cannot be empty/)
    })
  })

  describe('finalize', () => {
    it('rejects a malformed signature length', () => {
      const result = buildCosmosStakingTx(
        baseOpts([
          {
            type: 'delegate',
            delegatorAddress: FX.delegator,
            validatorAddress: FX.validator,
            amount: FX.amount,
            denom: FX.denom,
          },
        ])
      )
      expect(() => result.finalize('deadbeef')).toThrow(/expected 128-hex-char.*got 8/)
    })

    it('accepts a 128-hex-char (r||s) signature and produces broadcastable TxRaw', () => {
      const result = buildCosmosStakingTx(
        baseOpts([
          {
            type: 'delegate',
            delegatorAddress: FX.delegator,
            validatorAddress: FX.validator,
            amount: FX.amount,
            denom: FX.denom,
          },
        ])
      )
      const sigHex = 'a'.repeat(128)
      const finalized = result.finalize(sigHex)
      expect(finalized.txRawBytes).toBeInstanceOf(Uint8Array)
      expect(finalized.txRawBytes.length).toBeGreaterThan(0)
      expect(finalized.txBytesBase64).toMatch(/^[A-Za-z0-9+/=]+$/)
      expect(finalized.txHashHex).toMatch(/^[0-9A-F]{64}$/)
    })

    it('strips trailing recovery byte from 130-hex-char (r||s||v) MPC signatures', () => {
      const result = buildCosmosStakingTx(
        baseOpts([
          {
            type: 'delegate',
            delegatorAddress: FX.delegator,
            validatorAddress: FX.validator,
            amount: FX.amount,
            denom: FX.denom,
          },
        ])
      )
      const sigRS = 'a'.repeat(128)
      const sigRSV = sigRS + '01' // appended recovery byte
      const a = result.finalize(sigRS)
      const b = result.finalize(sigRSV)
      expect(a.txHashHex).toBe(b.txHashHex)
    })
  })
})
