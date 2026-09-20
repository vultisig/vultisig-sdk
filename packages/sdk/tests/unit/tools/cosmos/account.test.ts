import { describe, expect, it } from 'vitest'

import { parseAuthAccount } from '@/tools/cosmos/account'

describe('parseAuthAccount', () => {
  it('parses a top-level BaseAccount without coercing decimal strings', () => {
    expect(
      parseAuthAccount({
        account: {
          account_number: '18446744073709551615',
          sequence: '9007199254740993',
        },
      })
    ).toEqual({ accountNumber: '18446744073709551615', sequence: '9007199254740993' })
  })

  it('parses a base_account wrapper and converts numeric inputs to strings', () => {
    expect(
      parseAuthAccount({
        account: {
          '@type': '/ethermint.types.v1.EthAccount',
          base_account: { account_number: 42, sequence: 7 },
        },
      })
    ).toEqual({ accountNumber: '42', sequence: '7' })
  })

  it('parses a vesting account and preserves zero values', () => {
    expect(
      parseAuthAccount({
        account: {
          base_vesting_account: {
            base_account: { account_number: 0, sequence: '0' },
          },
        },
      })
    ).toEqual({ accountNumber: '0', sequence: '0' })
  })

  it('prefers vesting, then base_account, then top-level fields', () => {
    expect(
      parseAuthAccount({
        account: {
          account_number: '1',
          sequence: '2',
          base_account: { account_number: '3', sequence: '4' },
          base_vesting_account: {
            base_account: { account_number: '5', sequence: '6' },
          },
        },
      })
    ).toEqual({ accountNumber: '5', sequence: '6' })

    expect(
      parseAuthAccount({
        account: {
          account_number: '1',
          sequence: '2',
          base_account: { account_number: '3', sequence: '4' },
        },
      })
    ).toEqual({ accountNumber: '3', sequence: '4' })
  })

  it('fails closed when the selected nested account is missing a sequence', () => {
    expect(
      parseAuthAccount({
        account: {
          account_number: '1',
          sequence: '2',
          base_account: { account_number: '3', sequence: '4' },
          base_vesting_account: { base_account: { account_number: '5' } },
        },
      })
    ).toBeNull()

    expect(
      parseAuthAccount({
        account: {
          account_number: '1',
          sequence: '2',
          base_account: { account_number: '3' },
        },
      })
    ).toBeNull()
  })

  it.each([
    {},
    { account: {} },
    { account: { some_custom_shape: true } },
    { account: { account_number: '1' } },
    { account: { base_account: { sequence: '2' } } },
    { account: { base_vesting_account: { base_account: { sequence: '2' } } } },
  ])('returns null for an absent, unsupported, or incomplete account shape', response => {
    expect(parseAuthAccount(response)).toBeNull()
  })
})
