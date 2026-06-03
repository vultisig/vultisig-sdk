import { describe, expect, it } from 'vitest'

import { CowSwapOrder } from '../../sign/buildCowSwapOrder'
import {
  CowSwapKeysignData,
  cowSwapKeysignDataPrefix,
  decodeCowSwapKeysignData,
  encodeCowSwapKeysignData,
  isCowSwapKeysignData,
} from '../cowSwapKeysignData'

const order: CowSwapOrder = {
  sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  receiver: '0x1111111111111111111111111111111111111111',
  sellAmount: '1000000000000000000',
  buyAmount: '990000000',
  validTo: 1893456000,
  appData: '{"appCode":"vultisig"}',
  appDataHash: '0xabc0000000000000000000000000000000000000000000000000000000000000',
  feeAmount: '10000000000000000',
  kind: 'sell',
  partiallyFillable: false,
  sellTokenBalance: 'erc20',
  buyTokenBalance: 'erc20',
}

const data: CowSwapKeysignData = {
  order,
  chainId: 1,
  apiBase: 'https://api.cow.fi/mainnet',
  from: '0x1111111111111111111111111111111111111111',
}

describe('cowSwapKeysignData', () => {
  it('round-trips through encode/decode without loss', () => {
    const decoded = decodeCowSwapKeysignData(encodeCowSwapKeysignData(data))
    expect(decoded).toEqual(data)
  })

  it('preserves the permitRequired flag', () => {
    const withPermit = { ...data, permitRequired: true }
    expect(decodeCowSwapKeysignData(encodeCowSwapKeysignData(withPermit))).toEqual(withPermit)
  })

  it('prefixes the payload with the cowswap marker', () => {
    expect(encodeCowSwapKeysignData(data).startsWith(cowSwapKeysignDataPrefix)).toBe(true)
  })

  it('isCowSwapKeysignData detects marked payloads', () => {
    expect(isCowSwapKeysignData(encodeCowSwapKeysignData(data))).toBe(true)
  })

  it('returns null for non-CowSwap hex calldata (other aggregators)', () => {
    expect(decodeCowSwapKeysignData('0xdeadbeef')).toBeNull()
    expect(isCowSwapKeysignData('0xdeadbeef')).toBe(false)
  })

  it('returns null for an empty data field', () => {
    expect(decodeCowSwapKeysignData('')).toBeNull()
  })

  it('returns null for a marked-but-malformed payload instead of throwing', () => {
    expect(decodeCowSwapKeysignData(`${cowSwapKeysignDataPrefix}{not valid json`)).toBeNull()
  })

  it('returns null for valid JSON with a missing/wrong-typed field', () => {
    // missing `from`
    const withoutFrom = { order: data.order, chainId: data.chainId, apiBase: data.apiBase }
    expect(decodeCowSwapKeysignData(`${cowSwapKeysignDataPrefix}${JSON.stringify(withoutFrom)}`)).toBeNull()
    // chainId wrong type
    expect(
      decodeCowSwapKeysignData(`${cowSwapKeysignDataPrefix}${JSON.stringify({ ...data, chainId: '1' })}`)
    ).toBeNull()
    // order missing
    expect(
      decodeCowSwapKeysignData(`${cowSwapKeysignDataPrefix}${JSON.stringify({ ...data, order: null })}`)
    ).toBeNull()
    // a bare JSON primitive
    expect(decodeCowSwapKeysignData(`${cowSwapKeysignDataPrefix}42`)).toBeNull()
  })
})
