import { decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  buildCctpBridge,
  buildCctpClaim,
  cctpChains,
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

describe('CCTP registry — Circle published V1 addresses (oracle)', () => {
  // Hardcoded from https://developers.circle.com/cctp/v1/evm-smart-contracts
  // (CCTP V1 mainnet). These are the oracle — if the registry drifts from
  // Circle's published contracts, a claim can target a codeless address and
  // "succeed" without minting (burn-without-mint fund loss). Verified
  // on-chain via eth_getCode on every entry, 2026-07-13.
  const circlePublished: Record<string, { tokenMessenger: string; messageTransmitter: string; usdc: string }> = {
    Ethereum: {
      tokenMessenger: '0xBd3fa81B58Ba92a82136038B25aDec7066af3155',
      messageTransmitter: '0x0a992d191DEeC32aFe36203Ad87D7d289a738F81',
      usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    Avalanche: {
      tokenMessenger: '0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982',
      messageTransmitter: '0x8186359aF5F57FbB40c6b14A588d2A59C0C29880',
      usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    },
    Optimism: {
      tokenMessenger: '0x2B4069517957735bE00ceE0fadAE88a26365528f',
      messageTransmitter: '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8',
      usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    },
    Arbitrum: {
      tokenMessenger: '0x19330d10D9Cc8751218eaf51E8885D058642E08A',
      messageTransmitter: '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca',
      usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    },
    Base: {
      tokenMessenger: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
      // NOT 0xAD09780d193884d503182aD4F75D113B9B9a86E7 — that lookalike
      // (same prefix, different tail) is a codeless EOA on Base.
      messageTransmitter: '0xAD09780d193884d503182aD4588450C416D6F9D4',
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
    Polygon: {
      tokenMessenger: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
      messageTransmitter: '0xF3be9355363857F3e001be68856A2f96b4C39Ba9',
      usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    },
  }

  it('registry matches Circle exactly — every chain, every contract', () => {
    expect(Object.keys(cctpChains).sort()).toEqual(Object.keys(circlePublished).sort())
    for (const [chain, expected] of Object.entries(circlePublished)) {
      const actual = cctpChains[chain]
      expect(actual.tokenMessenger, `${chain} tokenMessenger`).toBe(expected.tokenMessenger)
      expect(actual.messageTransmitter, `${chain} messageTransmitter`).toBe(expected.messageTransmitter)
      expect(actual.usdc, `${chain} usdc`).toBe(expected.usdc)
    }
  })

  it('Base messageTransmitter is Circle-published, not the codeless-EOA lookalike', () => {
    expect(getCctpChain('Base')!.messageTransmitter).toBe('0xAD09780d193884d503182aD4588450C416D6F9D4')
    expect(getCctpChain('Base')!.messageTransmitter).not.toBe('0xAD09780d193884d503182aD4F75D113B9B9a86E7')
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
