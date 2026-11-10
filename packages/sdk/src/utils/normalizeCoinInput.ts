import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'

import type { CoinInput, SimpleCoinInput } from '../vault/swap-types'
import { VaultError, VaultErrorCode } from '../vault/VaultError'

/*
 * Runtime guards for coin objects from untyped (JS / agent) callers. Unknown keys
 * used to be ignored, so a token contract under the wrong key silently became a
 * native send (2026-11-02: 5 USDT requested, 0.004 BNB prepared).
 */

// Key -> required. `satisfies` keeps these lists in step with the coin types.
const accountCoinKeys = {
  chain: true,
  address: true,
  ticker: true,
  decimals: true,
  id: false,
  priceProviderId: false,
  logo: false,
  isHidden: false,
} satisfies Record<keyof AccountCoin, boolean>
const simpleCoinKeys = { chain: true, token: false } satisfies Record<keyof SimpleCoinInput, boolean>

const chains = new Set<unknown>(Object.values(Chain))
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isTokenId = (value: unknown) => isNonEmptyString(value) && !/^0x0{40}$/i.test(value)
const tokenIdRule = 'a non-empty token contract (omit id for native)'

const valueRules: Record<string, [(value: unknown) => boolean, string]> = {
  chain: [value => chains.has(value), 'a known Chain value'],
  address: [isNonEmptyString, 'a non-empty string'],
  ticker: [isNonEmptyString, 'a non-empty string'],
  decimals: [value => Number.isInteger(value) && (value as number) >= 0, 'a non-negative integer'],
  id: [isTokenId, tokenIdRule],
  token: [isNonEmptyString, 'a non-empty string'],
}

type Fields = Record<string, unknown>

const invalid = (shape: string, spec: object, problem: string) =>
  new VaultError(
    VaultErrorCode.InvalidConfig,
    `Invalid ${shape}: ${problem}. Accepted keys: ${Object.keys(spec).join(', ')}`
  )

const toFields = (input: unknown): Fields => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    const got = Array.isArray(input) ? 'an array' : String(input)
    throw new VaultError(VaultErrorCode.InvalidConfig, `Invalid coin: expected an object, got ${got}`)
  }
  return input as Fields
}

const validate = (shape: string, spec: Record<string, boolean>, fields: Fields) => {
  const unknown = Object.keys(fields).filter(key => !(key in spec))
  if (unknown.length) throw invalid(shape, spec, `unknown key(s) ${unknown.join(', ')}`)
  for (const [key, required] of Object.entries(spec)) {
    const value = fields[key]
    if (value === undefined) {
      if (required) throw invalid(shape, spec, `missing ${key}`)
      continue
    }
    const [isValid, rule] = valueRules[key] ?? [() => true, '']
    if (!isValid(value)) throw invalid(shape, spec, `${key} must be ${rule}, got ${JSON.stringify(value)}`)
  }
}

/** Validate an `AccountCoin`, copying a `contractAddress` alias into `id`. Never mutates the input. */
export const normalizeAccountCoin = (input: unknown): AccountCoin => {
  const { contractAddress, ...fields } = toFields(input)
  if (contractAddress !== undefined) {
    const fail = (problem: string) => invalid('AccountCoin', accountCoinKeys, problem)
    if (!isTokenId(contractAddress)) throw fail(`contractAddress must be ${tokenIdRule}`)
    if (fields.id !== undefined && fields.id !== contractAddress) {
      throw fail(`contractAddress ${contractAddress} differs from id ${String(fields.id)}`)
    }
    fields.id = contractAddress
  }
  validate('AccountCoin', accountCoinKeys, fields)
  return (contractAddress === undefined ? input : fields) as AccountCoin
}

/**
 * Validate a swap `CoinInput`. Anything carrying an `AccountCoin`-only key is an
 * `AccountCoin` (so a broken one throws instead of resolving to the native coin).
 */
export const normalizeCoinInput = (input: unknown): CoinInput => {
  const fields = toFields(input)
  const isAccount = Object.keys(fields).some(
    key => key === 'contractAddress' || (key in accountCoinKeys && !(key in simpleCoinKeys))
  )
  if (isAccount) return normalizeAccountCoin(fields)
  validate('SimpleCoinInput', simpleCoinKeys, fields)
  return fields as SimpleCoinInput
}
