import { describe, expect, it } from 'vitest'

import { assertSafeDestination } from './dangerousAddresses'
import {
  assertSafeTokenTransferDestination,
  decodeErc20Approve,
  decodeErc20Recipient,
  decodeErc20RecipientFromSig,
  isErc20TransferCalldata,
} from './tokenTransferGuards'

// architecture#1774 — ported from agent-backend-ts's local fork
// (src/mastra/tools/mcp/lib/dangerous-addresses.test.ts), the SDK's only
// prior copy of these tests.

const SELECTOR_TRANSFER = 'a9059cbb'
const SELECTOR_TRANSFER_FROM = '23b872dd'
const pad32 = (addr20: string) => '000000000000000000000000' + addr20.replace(/^0x/, '').toLowerCase()
const AMOUNT_1 = '0'.repeat(63) + '1'
const transferCalldata = (addr20: string) => `0x${SELECTOR_TRANSFER}${pad32(addr20)}${AMOUNT_1}`
const transferFromCalldata = (from20: string, to20: string) =>
  `0x${SELECTOR_TRANSFER_FROM}${pad32(from20)}${pad32(to20)}${AMOUNT_1}`

const ZERO = '0x0000000000000000000000000000000000000000'
const DEAD = '0x000000000000000000000000000000000000dead'
const SAFE = '0x742d35cc6634c0532925a3b844bc454e4438f44e'

describe('calldata-recipient guard chain (decode -> assertSafeDestination)', () => {
  it('decodeErc20Recipient extracts the transfer recipient from raw calldata', () => {
    expect(decodeErc20Recipient(transferCalldata(SAFE))?.toLowerCase()).toBe(SAFE)
    expect(decodeErc20Recipient(transferCalldata(ZERO))?.toLowerCase()).toBe(ZERO)
  })

  it('decodeErc20Recipient extracts the recipient from transferFrom (second address slot)', () => {
    const from = '0x1111111111111111111111111111111111111111'
    expect(decodeErc20Recipient(transferFromCalldata(from, SAFE))?.toLowerCase()).toBe(SAFE)
  })

  it('REJECTS a burn recipient hidden in the calldata (decode -> assertSafeDestination throws)', () => {
    for (const burn of [ZERO, DEAD]) {
      const decoded = decodeErc20Recipient(transferCalldata(burn))
      expect(decoded, burn).toBeTruthy()
      expect(() => assertSafeDestination('Ethereum', decoded as string), burn).toThrow(/Refusing to build/)
    }
  })

  it('ALLOWS a safe recipient hidden in the calldata (decode -> assertSafeDestination passes)', () => {
    const decoded = decodeErc20Recipient(transferCalldata(SAFE))
    expect(() => assertSafeDestination('Ethereum', decoded as string)).not.toThrow()
  })

  it('returns null for an un-decoded selector (e.g. approve) — the RECIPIENT decoder is a no-op on approve', () => {
    expect(decodeErc20Recipient(`0x095ea7b3${pad32(SAFE)}${AMOUNT_1}`)).toBeNull()
  })

  it('returns null for malformed/truncated calldata', () => {
    expect(decodeErc20Recipient('0x')).toBeNull()
    expect(decodeErc20Recipient(`0x${SELECTOR_TRANSFER}`)).toBeNull()
    expect(decodeErc20Recipient(123 as unknown as string)).toBeNull()
  })
})

describe('isErc20TransferCalldata', () => {
  it('true for transfer and transferFrom selectors', () => {
    expect(isErc20TransferCalldata(transferCalldata(SAFE))).toBe(true)
    expect(isErc20TransferCalldata(transferFromCalldata(SAFE, SAFE))).toBe(true)
  })

  it('false for approve and ERC-721 safeTransferFrom (deliberately out of scope)', () => {
    expect(isErc20TransferCalldata(`0x095ea7b3${pad32(SAFE)}${AMOUNT_1}`)).toBe(false)
    expect(isErc20TransferCalldata(`0x42842e0e${pad32(SAFE)}${pad32(SAFE)}${AMOUNT_1}`)).toBe(false)
  })

  it('false for non-string input', () => {
    expect(isErc20TransferCalldata(undefined as unknown as string)).toBe(false)
  })
})

// #1454-equivalent: a raw approve(spender,uint256) was OPAQUE — no spender
// decode, no WYSIWYS surface. decodeErc20Approve pulls the spender + allowance
// out so the SAME registry/dead-address guards can run on it.
const MAX_UINT256_HEX = 'f'.repeat(64)
const approveCalldata = (spender20: string, amountHex = AMOUNT_1) => `0x095ea7b3${pad32(spender20)}${amountHex}`

describe('decodeErc20Approve', () => {
  it('extracts the spender + amount from raw approve calldata', () => {
    expect(decodeErc20Approve(approveCalldata(SAFE))).toEqual({ spender: SAFE, amount: 1n })
    const unlimited = decodeErc20Approve(approveCalldata(SAFE, MAX_UINT256_HEX))
    expect(unlimited?.spender).toBe(SAFE)
    expect(unlimited?.amount).toBe((1n << 256n) - 1n)
  })

  it('REJECTS a burn/dangerous spender hidden in the calldata (decode -> assertSafeDestination throws)', () => {
    for (const burn of [ZERO, DEAD]) {
      const decoded = decodeErc20Approve(approveCalldata(burn))
      expect(decoded?.spender, burn).toBe(burn)
      expect(() => assertSafeDestination('Ethereum', decoded!.spender), burn).toThrow(/Refusing to build/)
    }
  })

  it('ALLOWS a safe spender hidden in the calldata (decode -> assertSafeDestination passes)', () => {
    const decoded = decodeErc20Approve(approveCalldata(SAFE))
    expect(() => assertSafeDestination('Ethereum', decoded!.spender)).not.toThrow()
  })

  it('returns null for a non-approve selector (transfer) and for malformed/truncated calldata', () => {
    expect(decodeErc20Approve(transferCalldata(SAFE))).toBeNull()
    expect(decodeErc20Approve('0x095ea7b3')).toBeNull() // selector only, no args
    expect(decodeErc20Approve(`0x095ea7b3${pad32(SAFE)}`)).toBeNull() // missing amount slot
    expect(decodeErc20Approve('0x')).toBeNull()
  })
})

describe('decodeErc20RecipientFromSig', () => {
  it('extracts the recipient from a transfer(address,uint256) signature + args', () => {
    expect(decodeErc20RecipientFromSig('transfer(address,uint256)', [SAFE, '1000000'])).toBe(SAFE)
    expect(decodeErc20RecipientFromSig('function transfer(address to, uint256 amount)', [SAFE, '1'])).toBe(SAFE)
  })

  it('extracts the SECOND address for transferFrom/safeTransferFrom (never the "from")', () => {
    const from = '0x1111111111111111111111111111111111111111'
    expect(decodeErc20RecipientFromSig('transferFrom(address,address,uint256)', [from, SAFE, '1'])).toBe(SAFE)
    expect(decodeErc20RecipientFromSig('safeTransferFrom(address,address,uint256)', [from, SAFE, '1'])).toBe(SAFE)
  })

  it('returns null for a non-transfer signature (e.g. approve)', () => {
    expect(decodeErc20RecipientFromSig('approve(address,uint256)', [SAFE, '1'])).toBeNull()
  })

  it('returns null for malformed input (wrong arg types, missing args, non-array args)', () => {
    expect(decodeErc20RecipientFromSig('transfer(uint256,uint256)', ['1', '1'])).toBeNull()
    expect(decodeErc20RecipientFromSig('transfer(address,uint256)', [SAFE])).not.toBeNull() // args[0] present is enough
    expect(decodeErc20RecipientFromSig('transfer(address,uint256)', 'not-an-array')).toBeNull()
    expect(decodeErc20RecipientFromSig(123, [SAFE, '1'])).toBeNull()
  })
})

// A token sent to a known token CONTRACT (most often its own contract)
// permanently strands the funds. These lock the fix: a registry match
// (knownTokensIndex), never an eth_getCode probe.
describe('assertSafeTokenTransferDestination', () => {
  // Real mainnet USDC contract — present in the SDK's knownTokensIndex.
  const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  // Real mainnet USDT contract — a DIFFERENT known token contract on the same chain.
  const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
  const WALLET = '0x742d35Cc6634C0532925a3b844Bc454e4438f44'

  it('BLOCKS sending USDC to the USDC contract itself (the exact prod repro)', () => {
    expect(() => assertSafeTokenTransferDestination('Ethereum', USDC_ETHEREUM, USDC_ETHEREUM)).toThrow(
      /USDC.*USDC token contract|permanently burn/i
    )
  })

  it('BLOCKS case-mutated same-token-contract recipient (checksum vs lowercase)', () => {
    expect(() => assertSafeTokenTransferDestination('Ethereum', USDC_ETHEREUM.toLowerCase(), USDC_ETHEREUM)).toThrow(
      /permanently burn/i
    )
  })

  it('BLOCKS sending a token to a DIFFERENT known token contract on the same chain', () => {
    expect(() => assertSafeTokenTransferDestination('Ethereum', USDT_ETHEREUM, USDC_ETHEREUM)).toThrow(
      /USDT token contract/i
    )
  })

  it('ALLOWS sending a token to a normal wallet address', () => {
    expect(() => assertSafeTokenTransferDestination('Ethereum', WALLET, USDC_ETHEREUM)).not.toThrow()
  })

  it('is a NO-OP for a native-coin send (no sendingTokenContract)', () => {
    expect(() => assertSafeTokenTransferDestination('Ethereum', USDC_ETHEREUM, undefined)).not.toThrow()
  })

  it('is a NO-OP when the recipient is not in the known-token registry (no eth_getCode probe)', () => {
    const RANDOM_CONTRACT = '0x1234567890123456789012345678901234567890'
    expect(() => assertSafeTokenTransferDestination('Ethereum', RANDOM_CONTRACT, USDC_ETHEREUM)).not.toThrow()
  })
})
