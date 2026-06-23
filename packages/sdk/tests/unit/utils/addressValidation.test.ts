import { describe, expect, it } from 'vitest'

import { classifyAddress, isAddressValidForChain, isSolanaAddress } from '../../../src/utils/addressFormat'
import { address, validate } from '../../../src/utils/addressValidation'
import { checkChainPrefix } from '../../../src/utils/chainPrefix'

// Real, well-known mainnet addresses (public — never funded by this test).
const ADDR = {
  eth: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik.eth
  osmo: 'osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyat',
  cosmos: 'cosmos1z0qrq605sjgcqpylfl4aa6s90x738j7m32g9j2',
  sol: '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs', // canonical example pubkey
  btcBech32: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  btcLegacy: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // genesis coinbase
  sui: '0x0000000000000000000000000000000000000000000000000000000000000002',
  tron: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
  xrp: 'rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv',
  // Cosmos delegator (account) vs validator-operator (valoper) addresses.
  cosmosValoper: 'cosmosvaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4epsluffn',
  osmoValoper: 'osmovaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4epsluffn',
}

describe('classifyAddress', () => {
  it.each([
    [ADDR.eth, 'evm'],
    [ADDR.osmo, 'cosmos'],
    [ADDR.cosmos, 'cosmos'],
    [ADDR.sol, 'solana'],
    [ADDR.btcBech32, 'btc'],
    [ADDR.btcLegacy, 'btc'],
    [ADDR.sui, 'sui'],
    [ADDR.tron, 'tron'],
    [ADDR.xrp, 'xrp'],
  ])('classifies %s as %s', (addr, family) => {
    expect(classifyAddress(addr)).toBe(family)
  })

  it('returns unknown for garbage', () => {
    expect(classifyAddress('not-an-address')).toBe('unknown')
    expect(classifyAddress('')).toBe('unknown')
  })

  it('disambiguates EVM (40 hex) from Sui (64 hex)', () => {
    expect(classifyAddress(ADDR.eth)).toBe('evm')
    expect(classifyAddress(ADDR.sui)).toBe('sui')
  })
})

describe('isSolanaAddress', () => {
  it('accepts a 32-byte base58 pubkey', () => {
    expect(isSolanaAddress(ADDR.sol)).toBe(true)
  })
  it('rejects a cosmos bech32 string that is base58-alphabet-ish', () => {
    expect(isSolanaAddress(ADDR.osmo)).toBe(false)
  })
  it('rejects an EVM address', () => {
    expect(isSolanaAddress(ADDR.eth)).toBe(false)
  })
  it('rejects valoper bech32 strings via the known-HRP guard (Go parity)', () => {
    // cosmosvaloper1 / osmovaloper1 are now in knownBech32HRPs (matches Go),
    // so a valoper string is never misclassified as a Solana key.
    expect(isSolanaAddress(ADDR.cosmosValoper)).toBe(false)
    expect(isSolanaAddress(ADDR.osmoValoper)).toBe(false)
  })
})

describe('isAddressValidForChain', () => {
  it('accepts EVM address on ethereum / base / arbitrum (shared 0x rule)', () => {
    expect(isAddressValidForChain(ADDR.eth, 'ethereum')).toBe(true)
    expect(isAddressValidForChain(ADDR.eth, 'base')).toBe(true)
    expect(isAddressValidForChain(ADDR.eth, 'arbitrum')).toBe(true)
  })
  it('rejects an osmo address claimed on ethereum (HRP mismatch)', () => {
    expect(isAddressValidForChain(ADDR.osmo, 'ethereum')).toBe(false)
  })
  it('rejects a cosmos1 address on terra (wrong HRP, fund-safety)', () => {
    expect(isAddressValidForChain(ADDR.cosmos, 'terra')).toBe(false)
  })
  it('accepts osmo address on osmosis (and via osmo alias)', () => {
    expect(isAddressValidForChain(ADDR.osmo, 'osmosis')).toBe(true)
    expect(isAddressValidForChain(ADDR.osmo, 'osmo')).toBe(true)
  })
  it('returns undefined for a chain with no FORMAT rule', () => {
    expect(isAddressValidForChain(ADDR.eth, 'madeupchain')).toBeUndefined()
  })

  // Valoper field-aware routing (ported from Go cosmosValopers). A validator
  // operator address must carry the <chain>valoper1… HRP, not the account HRP.
  describe("role: 'validator' (cosmos valoper HRP)", () => {
    it('accepts a cosmosvaloper1 address as a validator field on cosmos', () => {
      expect(isAddressValidForChain(ADDR.cosmosValoper, 'cosmos', 'validator')).toBe(true)
    })
    it('rejects a cosmos1 delegator address on a validator field (fund-safety)', () => {
      // The whole point of cosmosValopers: a cosmos1… delegator must NOT pass
      // where a cosmosvaloper1… operator is required.
      expect(isAddressValidForChain(ADDR.cosmos, 'cosmos', 'validator')).toBe(false)
    })
    it('rejects a valoper address on the account role (account rule, not valoper)', () => {
      expect(isAddressValidForChain(ADDR.cosmosValoper, 'cosmos', 'account')).toBe(false)
      expect(isAddressValidForChain(ADDR.cosmosValoper, 'cosmos')).toBe(false)
    })
    it('routes per-chain valoper HRP (osmovaloper on osmosis, alias-aware)', () => {
      expect(isAddressValidForChain(ADDR.osmoValoper, 'osmosis', 'validator')).toBe(true)
      expect(isAddressValidForChain(ADDR.osmoValoper, 'osmo', 'validator')).toBe(true)
      // wrong-chain valoper HRP is a mismatch
      expect(isAddressValidForChain(ADDR.cosmosValoper, 'osmosis', 'validator')).toBe(false)
    })
    it('terraclassic shares the terravaloper HRP with terra (Go parity)', () => {
      const terraValoper = 'terravaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4epsluffn'
      expect(isAddressValidForChain(terraValoper, 'terra', 'validator')).toBe(true)
      expect(isAddressValidForChain(terraValoper, 'terraclassic', 'validator')).toBe(true)
    })
    it('falls back to account rules for chains with no valoper entry (thorchain)', () => {
      // thorchain is intentionally omitted from cosmosValopers — validator role
      // falls back to the account HRP rather than over-blocking.
      const thorAddr = 'thor1clpqr4nrk4khgkxj78fcwwh6dl3uw4epsluffn'
      expect(isAddressValidForChain(thorAddr, 'thorchain', 'validator')).toBe(true)
    })
  })
})

describe('validate.chainPrefix', () => {
  it('flags an osmo address claimed as ethereum as a mismatch', () => {
    const r = validate.chainPrefix(ADDR.osmo, 'ethereum')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('mismatch')
    expect(r.detectedFamily).toBe('cosmos')
    expect(r.canonicalChain).toBe('ethereum')
  })
  it('passes a real EVM address on ethereum', () => {
    const r = validate.chainPrefix(ADDR.eth, 'eth')
    expect(r.valid).toBe(true)
    expect(r.reason).toBe('match')
  })
  it('fails open (valid) for an unknown chain', () => {
    const r = validate.chainPrefix(ADDR.eth, 'madeupchain')
    expect(r.valid).toBe(true)
    expect(r.reason).toBe('unknown-chain')
  })
  it('reports empty for blank input', () => {
    expect(validate.chainPrefix('', 'ethereum').reason).toBe('empty')
    expect(validate.chainPrefix(ADDR.eth, '').reason).toBe('empty')
  })
  it('checkChainPrefix is the same function as validate.chainPrefix', () => {
    expect(checkChainPrefix(ADDR.osmo, 'ethereum')).toEqual(validate.chainPrefix(ADDR.osmo, 'ethereum'))
  })
  it('validator role flags a cosmos1 delegator passed as a validator address', () => {
    const r = validate.chainPrefix(ADDR.cosmos, 'cosmos', 'validator')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('mismatch')
  })
  it('validator role passes a cosmosvaloper1 operator address', () => {
    const r = validate.chainPrefix(ADDR.cosmosValoper, 'cosmos', 'validator')
    expect(r.valid).toBe(true)
    expect(r.reason).toBe('match')
  })
})

describe('address namespace', () => {
  it('exposes classify / isValidFor / supportedChains', () => {
    expect(address.classify(ADDR.sol)).toBe('solana')
    expect(address.isValidFor(ADDR.eth, 'ethereum')).toBe(true)
    expect(address.supportedChains()).toContain('ethereum')
    expect(address.supportedChains()).toContain('osmosis')
  })
})
