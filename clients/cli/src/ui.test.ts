import { Chain } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmationRequiredError } from './core/errors'
import { resetOutput, setNonInteractive } from './lib/output'
import {
  confirmSwap,
  confirmTransaction,
  displayBalance,
  displayBalancesTable,
  displayPortfolio,
  displayTransactionPreview,
  formatBalanceAmount,
  formatBigintAmount,
} from './ui'

afterEach(() => {
  resetOutput()
  vi.restoreAllMocks()
})

// The confirm prompts are the fund-safety gate. In a non-interactive session
// (piped/redirected stdout or stdin, or --non-interactive/--ci) they must fail closed with a stable
// CONFIRMATION_REQUIRED error BEFORE any inquirer prompt is drawn. The stdout-spy
// assertion documents that the throw happens ahead of any render; stderr-vs-stdout
// routing of the prompt UI itself is covered in prompt.test.ts.
describe('confirm prompts fail closed in non-interactive mode', () => {
  it('confirmTransaction rejects with ConfirmationRequiredError and never writes to stdout', async () => {
    setNonInteractive(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(confirmTransaction()).rejects.toBeInstanceOf(ConfirmationRequiredError)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('confirmSwap rejects with ConfirmationRequiredError and never writes to stdout', async () => {
    setNonInteractive(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(confirmSwap()).rejects.toBeInstanceOf(ConfirmationRequiredError)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })
})

// The XRP account reserve made balances read as missing funds: the headline is
// the spendable (post-reserve) number, but nothing said so. Reserve-carrying
// balances must be labeled; every other chain's render stays byte-identical.
describe('displayBalance reserve labeling', () => {
  const captureLogs = () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    return logs
  }

  const xrpBalance = {
    amount: '2365052',
    formattedAmount: '2.365052',
    decimals: 6,
    symbol: 'XRP',
    chainId: 'Ripple',
    totalAmount: '3765052',
    reserveAmount: '1400000',
  }

  it('labels the spendable headline and prints the reserve breakdown', () => {
    const logs = captureLogs()

    displayBalance('Ripple', xrpBalance)

    expect(logs.find(line => line.includes('Amount:'))).toContain('2.365052 XRP (spendable)')
    expect(logs.find(line => line.includes('Reserve:'))).toContain('1.4 XRP locked (3.765052 XRP total on ledger)')
  })

  it('renders a consistent breakdown when the XRP balance is below the reserve requirement', () => {
    const logs = captureLogs()

    displayBalance('Ripple', {
      ...xrpBalance,
      amount: '0',
      formattedAmount: '0',
      totalAmount: '500000',
      reserveAmount: '500000',
    })

    expect(logs.find(line => line.includes('Amount:'))).toBe('  Amount: 0 XRP (spendable)')
    expect(logs.find(line => line.includes('Reserve:'))).toBe('  Reserve: 0.5 XRP locked (0.5 XRP total on ledger)')
  })

  it('keeps balances without a reserve byte-identical', () => {
    const logs = captureLogs()

    displayBalance('Bitcoin', {
      amount: '100000000',
      formattedAmount: '1',
      decimals: 8,
      symbol: 'BTC',
      chainId: 'Bitcoin',
    })

    expect(logs.find(line => line.includes('Amount:'))).toBe('  Amount: 1 BTC')
    expect(logs.some(line => line.includes('Reserve:'))).toBe(false)
    expect(logs.some(line => line.includes('spendable'))).toBe(false)
  })

  it('does not label a zero reserve', () => {
    const logs = captureLogs()

    displayBalance('Ripple', { ...xrpBalance, totalAmount: xrpBalance.amount, reserveAmount: '0' })

    expect(logs.find(line => line.includes('Amount:'))).toBe('  Amount: 2.365052 XRP')
    expect(logs.some(line => line.includes('Reserve:'))).toBe(false)
  })

  it('marks the portfolio Amount cell as spendable only for reserve-carrying rows', () => {
    const rows: object[][] = []
    vi.spyOn(console, 'table').mockImplementation((data: object[]) => {
      rows.push(data)
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    displayPortfolio(
      {
        totalValue: { amount: '10.00', currency: 'usd', lastUpdated: 0 },
        chainBalances: [
          { chain: Chain.Ripple, balance: xrpBalance },
          {
            chain: Chain.Bitcoin,
            balance: { amount: '100000000', formattedAmount: '1', decimals: 8, symbol: 'BTC', chainId: 'Bitcoin' },
          },
        ],
      },
      'usd'
    )

    expect(rows[0]).toEqual([
      expect.objectContaining({ Chain: Chain.Ripple, Amount: '2.365052 (spendable)' }),
      expect.objectContaining({ Chain: Chain.Bitcoin, Amount: '1' }),
    ])
  })

  it('marks the table Amount cell as spendable only for reserve-carrying rows', () => {
    const rows: object[][] = []
    vi.spyOn(console, 'table').mockImplementation((data: object[]) => {
      rows.push(data)
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    displayBalancesTable({
      Ripple: xrpBalance,
      Bitcoin: { amount: '100000000', formattedAmount: '1', decimals: 8, symbol: 'BTC', chainId: 'Bitcoin' },
    })

    expect(rows[0]).toEqual([
      expect.objectContaining({ Chain: 'Ripple', Amount: '2.365052 (spendable)' }),
      expect.objectContaining({ Chain: 'Bitcoin', Amount: '1' }),
    ])
  })
})

describe('displayTransactionPreview', () => {
  it('escapes terminal control bytes in the confirmation memo', () => {
    const memo = `literal\\x0A${String.fromCharCode(0, 10, 13, 27, 127, 155)}tail`
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    displayTransactionPreview('from', 'to', '1', 'XRP', Chain.Ripple, memo)

    const memoLine = logs.find(line => line.includes('Memo:'))
    expect(memoLine).toContain('literal\\\\x0A\\x00\\x0A\\x0D\\x1B\\x7F\\x9Btail')
    expect(memoLine).not.toContain(memo)
  })

  it('discloses the token contract on the Amount line, escaped, and omits it when absent', () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    const contractAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
    displayTransactionPreview(
      'from',
      'to',
      '1.0',
      'USDC.e',
      Chain.Polygon,
      undefined,
      undefined,
      undefined,
      contractAddress
    )
    expect(logs.find(line => line.includes('Amount:'))).toContain(`Amount: 1.0 USDC.e (${contractAddress})`)

    logs.length = 0
    displayTransactionPreview(
      'from',
      'to',
      '1.0',
      'USDC.e',
      Chain.Polygon,
      undefined,
      undefined,
      undefined,
      `evil${String.fromCharCode(27)}[2J`
    )
    const escapedLine = logs.find(line => line.includes('Amount:'))
    expect(escapedLine).toContain('evil\\x1B[2J')
    expect(escapedLine).not.toContain(String.fromCharCode(27))

    logs.length = 0
    displayTransactionPreview('from', 'to', '1.0', 'ETH', Chain.Ethereum)
    expect(logs.find(line => line.includes('Amount:'))).toBe('  Amount: 1.0 ETH')
  })
})

// formatBigintAmount delegates to the SDK's pure-bigint fromChainAmountExact.
// The old hand-rolled divisor was `BigInt(10 ** decimals)`, a float64 power
// exact only up to decimals=22 — past that it silently corrupted output.
describe('formatBigintAmount', () => {
  it('formats standard decimals (6/8/18) with hand-computed values', () => {
    expect(formatBigintAmount(1500000n, 6)).toBe('1.5')
    expect(formatBigintAmount(30558n, 8)).toBe('0.00030558')
    expect(formatBigintAmount(1500000000000000000n, 18)).toBe('1.5')
  })

  it('returns "0" for a zero amount', () => {
    expect(formatBigintAmount(0n, 18)).toBe('0')
  })

  it('trims trailing fraction zeros and drops the fraction entirely for whole numbers', () => {
    expect(formatBigintAmount(1000000n, 6)).toBe('1')
    expect(formatBigintAmount(1100000n, 6)).toBe('1.1')
  })

  it('formats a dust (fraction-only) amount', () => {
    expect(formatBigintAmount(1n, 18)).toBe('0.000000000000000001')
  })

  it('is exact at decimals=24, where the old float divisor drifted', () => {
    expect(formatBigintAmount(1234567890123456789012345n, 24)).toBe('1.234567890123456789012345')
    // Old `BigInt(10 ** 24)` divisor was 999999999999999983222784 (should be
    // 10^24 exactly) — the corrupted output would have been
    // '1.234567890123456805789561'.
  })

  it('is exact at decimals=30, where the old float divisor drifted across whole+fraction', () => {
    expect(formatBigintAmount(5123456789012345678901234567890n, 30)).toBe('5.12345678901234567890123456789')
    // Old `BigInt(10 ** 30)` divisor was 1000000000000000019884624838656
    // (should be 10^30 exactly) — the corrupted output would have been
    // '5.12345678901234557947811037461'.
  })
})

describe('formatBalanceAmount', () => {
  it('formats a raw string amount, delegating to formatBigintAmount', () => {
    expect(formatBalanceAmount('1234567', 6)).toBe('1.234567')
  })

  it('returns "0" for a zero/empty amount without throwing', () => {
    expect(formatBalanceAmount('0', 18)).toBe('0')
    expect(formatBalanceAmount('', 18)).toBe('0')
  })

  it('falls back to the raw string on a non-integer amount instead of throwing', () => {
    expect(formatBalanceAmount('not-a-number', 18)).toBe('not-a-number')
  })
})
