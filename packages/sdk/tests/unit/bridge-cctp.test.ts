import { decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  buildCctpBridge,
  buildCctpClaim,
  cctpSupportedChains,
  formatUsdc,
  getCctpChain,
  normalizeHexBytes,
  parseUsdcAmount,
} from '../../src/tools/bridge'
import { assertSafeEvmDestination, EVM_DANGEROUS_ADDRESSES, isEvmBurnAddress } from '../../src/utils/dangerousAddresses'

// Reference ABIs for decoding/asserting the encoded selectors + args.
const tokenMessengerAbi = [
  {
    name: 'depositForBurn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
  },
] as const

const erc20ApproveAbi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const messageTransmitterAbi = [
  {
    name: 'receiveMessage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const SENDER = '0x1111111111111111111111111111111111111111'

describe('parseUsdcAmount', () => {
  it('parses whole + fractional USDC into 6-decimal raw units', () => {
    expect(parseUsdcAmount('10')).toBe(10_000_000n)
    expect(parseUsdcAmount('10.5')).toBe(10_500_000n)
    expect(parseUsdcAmount('0.000001')).toBe(1n)
  })

  it('rejects negative, empty, and over-precise amounts', () => {
    expect(() => parseUsdcAmount('-1')).toThrow(/negative/)
    expect(() => parseUsdcAmount('')).toThrow(/empty/)
    expect(() => parseUsdcAmount('1.1234567')).toThrow(/too many decimal/)
  })

  it('round-trips via formatUsdc', () => {
    expect(formatUsdc(parseUsdcAmount('10.5'))).toBe('10.5')
    expect(formatUsdc(parseUsdcAmount('42'))).toBe('42')
  })
})

describe('buildCctpBridge', () => {
  it('builds a 2-tx approve+burn sequence (base -> arbitrum)', () => {
    const res = buildCctpBridge({
      sourceChain: 'Base',
      destinationChain: 'Arbitrum',
      amount: '10',
      from: SENDER,
    })

    expect(res.provider).toBe('cctp')
    expect(res.chain).toBe('Base')
    expect(res.chainId).toBe(8453)
    expect(res.toChain).toBe('Arbitrum')
    expect(res.destinationDomain).toBe(3) // Arbitrum CCTP domain
    expect(res.amountRaw).toBe('10000000')
    expect(res.transactions).toHaveLength(2)

    const [approve, burn] = res.transactions
    expect(approve.action).toBe('approve')
    expect(burn.action).toBe('burn')

    // approve(spender=TokenMessenger, amount=10e6) targets USDC contract
    const base = getCctpChain('Base')!
    expect(approve.to.toLowerCase()).toBe(base.usdc.toLowerCase())
    const decodedApprove = decodeFunctionData({ abi: erc20ApproveAbi, data: approve.data })
    expect(decodedApprove.functionName).toBe('approve')
    expect((decodedApprove.args[0] as string).toLowerCase()).toBe(base.tokenMessenger.toLowerCase())
    expect(decodedApprove.args[1]).toBe(10_000_000n)

    // depositForBurn targets TokenMessenger with the right domain + mintRecipient
    expect(burn.to.toLowerCase()).toBe(base.tokenMessenger.toLowerCase())
    const decodedBurn = decodeFunctionData({ abi: tokenMessengerAbi, data: burn.data })
    expect(decodedBurn.functionName).toBe('depositForBurn')
    expect(decodedBurn.args[0]).toBe(10_000_000n)
    expect(decodedBurn.args[1]).toBe(3) // destinationDomain
    // mintRecipient is the left-zero-padded 32-byte sender address
    expect(decodedBurn.args[2]).toBe(`0x${'0'.repeat(24)}${SENDER.slice(2).toLowerCase()}`)
    expect((decodedBurn.args[3] as string).toLowerCase()).toBe(base.usdc.toLowerCase())
  })

  it('rejects identical source/destination chains', () => {
    expect(() => buildCctpBridge({ sourceChain: 'Base', destinationChain: 'Base', amount: '1', from: SENDER })).toThrow(
      /must be different/
    )
  })

  it('rejects unsupported chains', () => {
    expect(() =>
      buildCctpBridge({ sourceChain: 'Solana', destinationChain: 'Base', amount: '1', from: SENDER })
    ).toThrow(/not supported by CCTP/)
  })

  it('refuses a burn-address mintRecipient (fund-safety) — all 3 canonical variants', () => {
    // dead (case-insensitive checksum)
    expect(() =>
      buildCctpBridge({
        sourceChain: 'Base',
        destinationChain: 'Arbitrum',
        amount: '1',
        to: '0x000000000000000000000000000000000000dEaD',
      })
    ).toThrow(/dead address/)

    // zero
    expect(() =>
      buildCctpBridge({
        sourceChain: 'Base',
        destinationChain: 'Arbitrum',
        amount: '1',
        to: '0x0000000000000000000000000000000000000000',
      })
    ).toThrow(/zero address/)

    // dead variant — the post-#415 `0xdead…942069` address the inlined
    // 2-address Set dropped (audit P1). Bridging to it minted USDC to a
    // permanently unspendable account.
    expect(() =>
      buildCctpBridge({
        sourceChain: 'Base',
        destinationChain: 'Arbitrum',
        amount: '1',
        to: '0xdead000000000000000042069420694206942069',
      })
    ).toThrow(/dead address variant/)
  })

  it('covers every CCTP-supported chain as a source', () => {
    for (const src of cctpSupportedChains) {
      const dst = cctpSupportedChains.find(c => c !== src)!
      const res = buildCctpBridge({ sourceChain: src, destinationChain: dst, amount: '1', from: SENDER })
      expect(res.transactions).toHaveLength(2)
    }
  })
})

describe('buildCctpClaim', () => {
  it('builds a single receiveMessage tx (arbitrum)', () => {
    const message = '0x' + 'ab'.repeat(200) // arbitrary even-length hex
    const attestation = '0x' + 'cd'.repeat(65) // exactly 65 bytes (valid V1)

    const res = buildCctpClaim({ destinationChain: 'Arbitrum', message, attestation })

    const arb = getCctpChain('Arbitrum')!
    expect(res.chain).toBe('Arbitrum')
    expect(res.chainId).toBe(42161)
    expect(res.tx.to.toLowerCase()).toBe(arb.messageTransmitter.toLowerCase())
    expect(res.tx.value).toBe('0')

    const decoded = decodeFunctionData({ abi: messageTransmitterAbi, data: res.tx.data })
    expect(decoded.functionName).toBe('receiveMessage')
    expect(decoded.args[0]).toBe(message)
    expect(decoded.args[1]).toBe(attestation)
  })

  it('rejects an attestation that is not a multiple of 65 bytes', () => {
    const message = '0x' + 'ab'.repeat(100)
    const badAttestation = '0x' + 'cd'.repeat(64) // 64 bytes, not 65
    expect(() => buildCctpClaim({ destinationChain: 'Arbitrum', message, attestation: badAttestation })).toThrow(
      /multiple of 65/
    )
  })

  it('rejects malformed hex', () => {
    expect(() => normalizeHexBytes('0xZZ', 'message')).toThrow(/not valid hex/)
    expect(() => normalizeHexBytes('0xabc', 'message')).toThrow(/odd hex length/)
  })
})

describe('shared EVM dangerous-address guard', () => {
  const REAL_EOA = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

  it('lists all 3 canonical EVM burn addresses (incl. the dropped dead variant)', () => {
    const keys = Object.keys(EVM_DANGEROUS_ADDRESSES)
    expect(keys).toContain('0x0000000000000000000000000000000000000000')
    expect(keys).toContain('0x000000000000000000000000000000000000dead')
    expect(keys).toContain('0xdead000000000000000042069420694206942069')
    expect(keys.length).toBe(3)
  })

  it('flags burn addresses case-insensitively and passes real EOAs', () => {
    expect(isEvmBurnAddress('0x000000000000000000000000000000000000dEaD')).toBe(true)
    expect(isEvmBurnAddress('0xDEAD000000000000000042069420694206942069')).toBe(true)
    expect(isEvmBurnAddress('0x0000000000000000000000000000000000000000')).toBe(true)
    expect(isEvmBurnAddress(REAL_EOA)).toBe(false)
  })

  it('shape-gates: a non-EVM-shaped string is not vetted as a burn address', () => {
    // 39 hex chars — not a valid EVM address shape, must not match.
    expect(isEvmBurnAddress('0x00000000000000000000000000000000000dead')).toBe(false)
    expect(() => assertSafeEvmDestination(REAL_EOA)).not.toThrow()
  })
})
