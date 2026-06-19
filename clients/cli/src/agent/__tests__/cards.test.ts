import { describe, expect, it } from 'vitest'

import {
  CLI_SUPPORTED_SURFACES,
  extractBalanceSummaryFromText,
  parseBalanceSummaryEnvelope,
  renderBalanceSummaryCard,
} from '../cards'

const VALID_ENVELOPE = {
  surface: 'balance_summary',
  accounts: [
    {
      chainId: 'Ethereum',
      address: '0x1234567890abcdef1234567890abcdef12345678',
      tokens: [
        { symbol: 'ETH', amountDecimal: '1.5', amountUsd: '$4,500.00' },
        { symbol: 'USDC', amountDecimal: '100', amountUsd: '$100.00' },
      ],
    },
    {
      chainId: 'Bitcoin',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      tokens: [{ symbol: 'BTC', amountDecimal: '0.05', amountUsd: '$3,000.00' }],
    },
  ],
}

describe('CLI_SUPPORTED_SURFACES', () => {
  it('advertises balance_summary', () => {
    expect(CLI_SUPPORTED_SURFACES).toContain('balance_summary')
  })
})

describe('parseBalanceSummaryEnvelope', () => {
  it('parses a valid envelope', () => {
    const card = parseBalanceSummaryEnvelope(VALID_ENVELOPE)
    expect(card).not.toBeNull()
    expect(card!.surface).toBe('balance_summary')
    expect(card!.accounts).toHaveLength(2)
    expect(card!.accounts[0].tokens).toHaveLength(2)
  })

  it('carries the stale freshness cue through', () => {
    const card = parseBalanceSummaryEnvelope({ ...VALID_ENVELOPE, stale: true, stale_secs: 120 })
    expect(card!.stale).toBe(true)
    expect(card!.staleSecs).toBe(120)
  })

  it('rejects a non-balance_summary surface', () => {
    expect(parseBalanceSummaryEnvelope({ surface: 'yield_opportunities', accounts: [] })).toBeNull()
  })

  it('rejects an envelope with no renderable accounts', () => {
    expect(parseBalanceSummaryEnvelope({ surface: 'balance_summary', accounts: [{ tokens: [] }] })).toBeNull()
  })

  it('rejects junk', () => {
    expect(parseBalanceSummaryEnvelope(null)).toBeNull()
    expect(parseBalanceSummaryEnvelope('nope')).toBeNull()
    expect(parseBalanceSummaryEnvelope({ surface: 'balance_summary' })).toBeNull()
  })

  it('drops accounts without a chainId but keeps the rest', () => {
    const card = parseBalanceSummaryEnvelope({
      surface: 'balance_summary',
      accounts: [{ tokens: [{ symbol: 'X', amountDecimal: '1' }] }, VALID_ENVELOPE.accounts[0]],
    })
    expect(card!.accounts).toHaveLength(1)
    expect(card!.accounts[0].chainId).toBe('Ethereum')
  })
})

describe('renderBalanceSummaryCard', () => {
  it('renders a human-readable table, not raw JSON', () => {
    const out = renderBalanceSummaryCard(parseBalanceSummaryEnvelope(VALID_ENVELOPE)!)
    expect(out).toContain('Ethereum')
    expect(out).toContain('ETH')
    expect(out).toContain('USDC')
    expect(out).toContain('BTC')
    // No raw envelope JSON in the output.
    expect(out).not.toContain('"surface"')
    expect(out).not.toContain('amountDecimal')
  })

  it('shows a USD total when amounts are priced', () => {
    const out = renderBalanceSummaryCard(parseBalanceSummaryEnvelope(VALID_ENVELOPE)!)
    // 4500 + 100 + 3000 = 7600
    expect(out).toContain('7,600.00')
    expect(out).toContain('Total')
  })

  it('shortens long addresses', () => {
    const out = renderBalanceSummaryCard(parseBalanceSummaryEnvelope(VALID_ENVELOPE)!)
    expect(out).toContain('…')
    expect(out).not.toContain('0x1234567890abcdef1234567890abcdef12345678')
  })
})

describe('extractBalanceSummaryFromText (legacy verbatim-echo fallback)', () => {
  it('returns null for plain prose', () => {
    expect(extractBalanceSummaryFromText('Your total is about $7,600.')).toBeNull()
  })

  it('extracts a bare echoed envelope and strips it from the text', () => {
    const text = JSON.stringify(VALID_ENVELOPE)
    const res = extractBalanceSummaryFromText(text)
    expect(res).not.toBeNull()
    expect(res!.card.accounts).toHaveLength(2)
    expect(res!.remainingText).toBe('')
  })

  it('extracts an envelope wrapped in a ```json code fence', () => {
    const text = 'Here are your balances:\n```json\n' + JSON.stringify(VALID_ENVELOPE) + '\n```'
    const res = extractBalanceSummaryFromText(text)
    expect(res).not.toBeNull()
    expect(res!.card.accounts).toHaveLength(2)
    // prose preserved, fence + JSON removed
    expect(res!.remainingText).toContain('Here are your balances')
    expect(res!.remainingText).not.toContain('surface')
    expect(res!.remainingText).not.toContain('```')
  })

  it('extracts an envelope embedded in surrounding prose', () => {
    const text = `Done. ${JSON.stringify(VALID_ENVELOPE)} Let me know if you need more.`
    const res = extractBalanceSummaryFromText(text)
    expect(res).not.toBeNull()
    expect(res!.remainingText).toContain('Done.')
    expect(res!.remainingText).toContain('Let me know')
    expect(res!.remainingText).not.toContain('surface')
  })

  it('ignores a non-card JSON object that mentions balance_summary', () => {
    const text = 'The {"foo":"balance_summary mention"} is not a card.'
    expect(extractBalanceSummaryFromText(text)).toBeNull()
  })
})
