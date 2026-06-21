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

  it('does not orphan staleSecs when stale is unset', () => {
    const card = parseBalanceSummaryEnvelope({ ...VALID_ENVELOPE, stale_secs: 120 })
    expect(card!.stale).toBeUndefined()
    expect(card!.staleSecs).toBeUndefined()
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

  it('strips terminal control/ANSI bytes from attacker-controlled fields', () => {
    // Token symbol/chain come from on-chain metadata (a scam token can pick any
    // symbol); on the legacy-echo path JSON.parse decodes an escape into a real
    // ESC byte. Neither must inject escape sequences into the table (OSC 8
    // hyperlink spoofing, OSC 52 clipboard writes, cursor moves). Build the
    // control bytes programmatically so no literal control char lives in source.
    const ESC = String.fromCharCode(0x1b)
    const BEL = String.fromCharCode(0x07)
    const C1_CSI = String.fromCharCode(0x9b) // single-byte C1 CSI introducer
    const card = parseBalanceSummaryEnvelope({
      surface: 'balance_summary',
      accounts: [
        {
          chainId: `Eth${ESC}[31mereum`,
          address: '0xabc',
          tokens: [{ symbol: `EV${ESC}]8;;http://evil${BEL}IL`, amountDecimal: `1\r\n0${C1_CSI}`, amountUsd: '$10' }],
        },
      ],
    })!
    // Parser strips the control bytes at the boundary, leaving only inert
    // printable text; the renderer only ever prints these parsed fields, so the
    // ESC/BEL/C1 introducers can no longer form an escape sequence on the TTY.
    expect(card.accounts[0].chainId).toBe('Eth[31mereum')
    expect(card.accounts[0].tokens[0].symbol).toBe('EV]8;;http://evilIL')
    expect(card.accounts[0].tokens[0].amountDecimal).toBe('10')
    // renderBalanceSummaryCard must not throw on the coerced card. (Its output
    // still carries chalk's own SGR styling — expected, distinct from injection.)
    expect(() => renderBalanceSummaryCard(card)).not.toThrow()
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

  it('bails on pathological oversized content instead of scanning O(n²)', () => {
    // A crafted message of deeply nested braces would make matchBrace O(n²);
    // content past the backstop returns null (raw text prints) rather than hang.
    const huge = 'balance_summary ' + '{'.repeat(150_000) + '}'.repeat(150_000)
    expect(extractBalanceSummaryFromText(huge)).toBeNull()
  })
})
