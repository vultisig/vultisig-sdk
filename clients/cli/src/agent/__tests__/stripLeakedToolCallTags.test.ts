import { describe, expect, it } from 'vitest'

import { stripLeakedToolCallTags } from '../session'

describe('stripLeakedToolCallTags', () => {
  it('returns empty string for empty input', () => {
    expect(stripLeakedToolCallTags('')).toBe('')
  })

  it('returns text unchanged when no tags are present', () => {
    const text = 'Your balance is 1.5 ETH.'
    expect(stripLeakedToolCallTags(text)).toBe(text)
  })

  it('preserves text that happens to contain the word "invoke" but no tags', () => {
    const text = 'You can invoke the transfer function directly.'
    expect(stripLeakedToolCallTags(text)).toBe(text)
  })

  it('strips a full minimax:tool_call block and returns only narrative', () => {
    const text = [
      'Let me build the close transaction.',
      '<minimax:tool_call>',
      '<invoke name="abi_encode">',
      '<parameter name="signature">transfer(address,uint256)</parameter>',
      '</invoke>',
      '</minimax:tool_call>',
    ].join('\n')

    const cleaned = stripLeakedToolCallTags(text)
    expect(cleaned).toBe('Let me build the close transaction.')
    expect(cleaned).not.toContain('<invoke')
    expect(cleaned).not.toContain('minimax:tool_call')
  })

  it('strips bare <invoke> blocks without the minimax wrapper', () => {
    const text = [
      'Position 1249931 is a USDC/WETH LP on Ethereum.',
      '<invoke name="abi_encode">',
      '<parameter name="signature">decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))</parameter>',
      '</invoke>',
    ].join('\n')

    const cleaned = stripLeakedToolCallTags(text)
    expect(cleaned).toContain('Position 1249931')
    expect(cleaned).not.toContain('<invoke')
    expect(cleaned).not.toContain('abi_encode')
  })

  it('strips orphan closer tags without a matching opener', () => {
    const text = 'Your balance is 1.5 ETH.</minimax:tool_call>'
    const cleaned = stripLeakedToolCallTags(text)
    expect(cleaned).toBe('Your balance is 1.5 ETH.')
  })

  it('strips multiple invoke blocks and preserves narrative between them', () => {
    // Matches the exact production incident shape.
    const text = [
      'Close the position.',
      '<invoke name="abi_encode">',
      '<parameter name="signature">decreaseLiquidity(...)</parameter>',
      '</invoke>',
      'Then collect fees.',
      '<invoke name="abi_encode">',
      '<parameter name="signature">collect(...)</parameter>',
      '</invoke>',
      '</minimax:tool_call>',
    ].join('\n')

    const cleaned = stripLeakedToolCallTags(text)
    expect(cleaned).toContain('Close the position.')
    expect(cleaned).toContain('Then collect fees.')
    expect(cleaned).not.toContain('<invoke')
    expect(cleaned).not.toContain('minimax:tool_call')
  })

  it('collapses run of 3+ newlines left by tag removal', () => {
    const text = [
      'First line.',
      '<invoke name="t"><parameter name="x">y</parameter></invoke>',
      '',
      '',
      'Second line.',
    ].join('\n')

    const cleaned = stripLeakedToolCallTags(text)
    expect(cleaned.split(/\n{3,}/).length).toBe(1) // no runs of 3+ newlines
    expect(cleaned).toContain('First line.')
    expect(cleaned).toContain('Second line.')
  })

  it('returns empty string when text is purely tags with nothing else', () => {
    const text = '<minimax:tool_call><invoke name="t"></invoke></minimax:tool_call>'
    expect(stripLeakedToolCallTags(text)).toBe('')
  })
})
