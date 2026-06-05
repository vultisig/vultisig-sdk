import { describe, expect, it } from 'vitest'

import { formatMcpHelp, parseMcpArgs } from '../src/args'

describe('MCP CLI argument parser', () => {
  it('defaults to the defi profile with no vault selector', () => {
    expect(parseMcpArgs([])).toEqual({ profile: 'defi', vaultId: undefined, vaultFile: undefined, setup: false })
  })

  it('parses --vault-id', () => {
    expect(parseMcpArgs(['--vault-id', 'vault-123'])).toMatchObject({
      profile: 'defi',
      vaultId: 'vault-123',
      vaultFile: undefined,
    })
  })

  it('parses --vault-file', () => {
    expect(parseMcpArgs(['--vault-file', './vault.vult'])).toMatchObject({
      vaultId: undefined,
      vaultFile: './vault.vult',
    })
  })

  it('parses --vault as an ID for non-path values', () => {
    expect(parseMcpArgs(['--vault', 'vault-123'])).toMatchObject({
      vaultId: 'vault-123',
      vaultFile: undefined,
    })
  })

  it('parses --vault as a file for path-like values', () => {
    expect(parseMcpArgs(['--vault', './vault.vult'])).toMatchObject({
      vaultId: undefined,
      vaultFile: './vault.vult',
    })
  })

  it('parses profile and setup', () => {
    expect(parseMcpArgs(['--profile', 'harness', '--setup', '--vault', './vault.vult'])).toMatchObject({
      profile: 'harness',
      setup: true,
      vaultFile: './vault.vult',
    })
  })

  it('rejects unknown options instead of silently ignoring them', () => {
    expect(() => parseMcpArgs(['--vault', 'intended-vault', '--surprise'])).toThrow('Unknown option "--surprise".')
  })

  it('rejects stale --vault usage with a missing value', () => {
    expect(() => parseMcpArgs(['--vault'])).toThrow('Missing value for --vault.')
  })

  it('rejects flag-like values for vault selectors', () => {
    expect(() => parseMcpArgs(['--vault', '--surprise'])).toThrow('Missing value for --vault.')
  })

  it('rejects conflicting vault selectors', () => {
    expect(() => parseMcpArgs(['--vault', 'vault-123', '--vault-file', './vault.vult'])).toThrow(
      'Specify only one of --vault, --vault-id, or --vault-file.'
    )
  })

  it('includes --vault in help output', () => {
    expect(formatMcpHelp()).toContain('--vault <id-or-path>')
  })
})
