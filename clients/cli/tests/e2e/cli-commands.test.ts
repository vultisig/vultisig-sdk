/**
 * E2E CLI command tests — runs vsig against a real vault.
 *
 * Prerequisites:
 *   1. `vsig auth setup` has been run (vault configured in keyring)
 *   2. CLI is built: `node build.mjs`
 *   3. Run with: npx vitest run tests/e2e/
 *
 * These tests use --output json --non-interactive for deterministic parsing.
 * Destructive operations use --dry-run where available.
 */

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const CLI = resolve(__dirname, '../../dist/index.js')
const TIMEOUT = 30_000

type ExecResult = { stdout: string; stderr: string; code: number }

function vsig(...args: string[]): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(
      'node',
      [CLI, '--output', 'json', '--non-interactive', ...args],
      { timeout: TIMEOUT },
      (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as any)?.code ?? 0 })
      }
    )
  })
}

function parseJson(result: ExecResult): any {
  const text = result.stdout.trim()
  if (!text) return null
  // The signing flow may dump log lines before the JSON. Extract the JSON object.
  const jsonStart = text.lastIndexOf('\n{')
  if (jsonStart >= 0) {
    return JSON.parse(text.slice(jsonStart + 1))
  }
  return JSON.parse(text)
}

function expectOk(json: any): any {
  expect(json).toBeTruthy()
  expect(json.success).toBe(true)
  expect(json.v).toBe(1)
  expect(json.data).toBeTruthy()
  return json.data
}

function expectError(json: any): any {
  expect(json).toBeTruthy()
  expect(json.success).toBe(false)
  expect(json.v).toBe(1)
  expect(json.error).toBeTruthy()
  expect(json.error.code).toBeTruthy()
  expect(typeof json.error.exitCode).toBe('number')
  expect(typeof json.error.retryable).toBe('boolean')
  return json.error
}

// ============================================================================
// Vault info & auth
// ============================================================================

describe('vault info & auth', () => {
  it('auth status returns configured vaults', async () => {
    const result = await vsig('auth', 'status')
    const data = expectOk(parseJson(result))
    expect(data.vaults).toBeInstanceOf(Array)
    expect(data.vaults.length).toBeGreaterThan(0)
    const vault = data.vaults[0]
    expect(vault.id).toBeTruthy()
    expect(vault.name).toBeTruthy()
    expect(typeof vault.hasCredentials).toBe('boolean')
  })

  it('vaults lists stored vaults', async () => {
    const result = await vsig('vaults')
    const data = expectOk(parseJson(result))
    expect(data.vaults).toBeInstanceOf(Array)
    expect(data.vaults.length).toBeGreaterThan(0)
    const vault = data.vaults[0]
    expect(vault.type).toBe('fast')
    expect(vault.isActive).toBe(true)
  })

  it('info returns vault details', async () => {
    const result = await vsig('info')
    const data = expectOk(parseJson(result))
    expect(data.vault.id).toBeTruthy()
    expect(data.vault.name).toBeTruthy()
    expect(data.vault.type).toBe('fast')
    expect(data.vault.threshold).toBe(2)
    expect(data.vault.totalSigners).toBe(2)
    expect(data.vault.chains).toBeInstanceOf(Array)
    expect(data.vault.chains.length).toBeGreaterThan(0)
    expect(data.vault.publicKeys.ecdsa).toBeTruthy()
    expect(data.vault.publicKeys.eddsa).toBeTruthy()
  })

  it('server reports VultiServer and relay status', async () => {
    const result = await vsig('server')
    const data = expectOk(parseJson(result))
    expect(data.server.fastVault.online).toBe(true)
    expect(typeof data.server.fastVault.latency).toBe('number')
    expect(data.server.messageRelay.online).toBe(true)
  })
})

// ============================================================================
// Chains & addresses
// ============================================================================

describe('chains & addresses', () => {
  it('chains lists active chains', async () => {
    const result = await vsig('chains')
    const data = expectOk(parseJson(result))
    expect(data.chains).toBeInstanceOf(Array)
    expect(data.chains).toContain('Bitcoin')
    expect(data.chains).toContain('Ethereum')
  })

  it('addresses returns address per active chain', async () => {
    const result = await vsig('addresses')
    const data = expectOk(parseJson(result))
    expect(data.addresses).toBeTruthy()
    expect(data.addresses.Bitcoin).toMatch(/^bc1/)
    expect(data.addresses.Ethereum).toMatch(/^0x/)
    expect(data.addresses.Solana).toBeTruthy()
    expect(data.addresses.THORChain).toMatch(/^thor1/)
  })

  it('chains --add is idempotent for existing chain', async () => {
    const result = await vsig('chains', '--add', 'Ethereum')
    // When chain is already active, CLI prints text confirmation (not JSON)
    // Just verify it doesn't error
    expect(result.code).toBe(0)
  })
})

// ============================================================================
// Balances & portfolio
// ============================================================================

describe('balances & portfolio', () => {
  it('balance returns balances for all active chains', async () => {
    const result = await vsig('balance')
    const data = expectOk(parseJson(result))
    expect(data.balances).toBeTruthy()
    const chains = Object.keys(data.balances)
    expect(chains.length).toBeGreaterThan(0)
    for (const chain of chains) {
      const b = data.balances[chain]
      expect(b.amount).toBeTruthy()
      expect(b.symbol).toBeTruthy()
      expect(typeof b.decimals).toBe('number')
    }
  })

  it('balance <chain> returns balance for specific chain', async () => {
    const result = await vsig('balance', 'THORChain')
    const data = expectOk(parseJson(result))
    expect(data.chain).toBe('THORChain')
    expect(data.balance).toBeTruthy()
    expect(data.balance.symbol).toBe('RUNE')
    expect(parseFloat(data.balance.formattedAmount)).toBeGreaterThan(0)
  })

  it('balance with --tokens flag works', async () => {
    const result = await vsig('balance', 'Ethereum', '--tokens')
    const data = expectOk(parseJson(result))
    // Single-chain balance response
    expect(data.chain).toBe('Ethereum')
    expect(data.balance).toBeTruthy()
  })

  it(
    'portfolio returns fiat valuations',
    async () => {
      const result = await vsig('portfolio')
      const data = expectOk(parseJson(result))
      expect(data.portfolio).toBeTruthy()
      expect(data.portfolio.totalValue).toBeTruthy()
      expect(data.portfolio.totalValue.currency).toBe('usd')
      expect(parseFloat(data.portfolio.totalValue.amount)).toBeGreaterThan(0)
      expect(data.portfolio.chainBalances).toBeInstanceOf(Array)
      expect(data.portfolio.chainBalances.length).toBeGreaterThan(0)
    },
    TIMEOUT
  )

  it(
    'portfolio --currency eur changes currency',
    async () => {
      const result = await vsig('portfolio', '--currency', 'eur')
      const data = expectOk(parseJson(result))
      expect(data.currency).toBe('eur')
    },
    TIMEOUT
  )
})

// ============================================================================
// Output flags (--fields, --quiet, --ci)
// ============================================================================

describe('output flags', () => {
  it('--fields filters JSON output to specified fields', async () => {
    const result = await vsig('balance', '--fields', 'formattedAmount,symbol')
    const data = expectOk(parseJson(result))
    const firstChain = Object.values(data.balances)[0] as Record<string, unknown>
    expect(firstChain.formattedAmount).toBeTruthy()
    expect(firstChain.symbol).toBeTruthy()
    // Filtered-out fields should be absent
    expect(firstChain.decimals).toBeUndefined()
    expect(firstChain.chainId).toBeUndefined()
  })

  it('--fields warns on unknown fields', async () => {
    const result = await vsig('balance', '--fields', 'nonexistent,symbol')
    expect(result.stderr).toContain('unknown field')
    expect(result.stderr).toContain('nonexistent')
  })

  it('--quiet preserves zero values', async () => {
    const result = await vsig('balance', '-q')
    const data = expectOk(parseJson(result))
    const balances = data.balances as Record<string, Record<string, unknown>>
    expect(Object.keys(balances).length).toBeGreaterThan(0)
    // Verify zero-valued fields are preserved, not stripped
    for (const chain of Object.values(balances)) {
      expect(chain.decimals).toBeDefined()
      expect(chain.symbol).toBeDefined()
    }
  })

  it('--ci implies json + non-interactive + quiet', async () => {
    const result = await new Promise<ExecResult>(resolve => {
      execFile('node', [CLI, '--ci', 'balance'], { timeout: TIMEOUT }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as any)?.code ?? 0 })
      })
    })
    const json = parseJson(result)
    expect(json.success).toBe(true)
    // --ci should produce JSON output (v1 envelope) with no spinner/color stderr
    expect(json.v).toBe(1)
    expect(json.data).toBeTruthy()
    expect(result.stderr).toBe('')
  })
})

// ============================================================================
// Tokens
// ============================================================================

describe('tokens', () => {
  it('tokens lists tokens for a chain', async () => {
    const result = await vsig('tokens', 'Ethereum')
    const data = expectOk(parseJson(result))
    expect(data.chain).toBe('Ethereum')
    expect(data.tokens).toBeInstanceOf(Array)
  })

  it(
    'tokens --discover discovers tokens on a chain',
    async () => {
      const result = await vsig('tokens', 'Ethereum', '--discover')
      const data = expectOk(parseJson(result))
      expect(data.chain).toBe('Ethereum')
      expect(typeof data.count).toBe('number')
    },
    TIMEOUT
  )
})

// ============================================================================
// Send (dry-run only)
// ============================================================================

describe('send (dry-run)', () => {
  it('send --dry-run returns preview without signing', async () => {
    const result = await vsig('send', 'THORChain', 'thor1ed0jg8l8475skeezjt4202rmtsvrnclrz664km', '0.01', '--dry-run')
    const data = expectOk(parseJson(result))
    expect(data.dryRun).toBe(true)
    expect(data.chain).toBe('THORChain')
    expect(data.to).toBe('thor1ed0jg8l8475skeezjt4202rmtsvrnclrz664km')
    expect(data.amount).toBe('0.01')
    expect(data.symbol).toBe('RUNE')
    expect(parseFloat(data.balance)).toBeGreaterThan(0)
  })

  it('send --dry-run warns on insufficient balance', async () => {
    const result = await vsig('send', 'Ethereum', '0x376F5E6244a81EF5bD6fF747E9EDb262C8f19abC', '999', '--dry-run')
    const data = expectOk(parseJson(result))
    expect(data.dryRun).toBe(true)
    expect(data.warning).toContain('Insufficient')
  })

  it('send fails without amount or --max', async () => {
    const result = await vsig('send', 'THORChain', 'thor1ed0jg8l8475skeezjt4202rmtsvrnclrz664km')
    const json = parseJson(result)
    expectError(json)
  })

  it('send fails with both amount and --max', async () => {
    const result = await vsig('send', 'THORChain', 'thor1ed0jg8l8475skeezjt4202rmtsvrnclrz664km', '0.1', '--max')
    const json = parseJson(result)
    expectError(json)
  })
})

// ============================================================================
// Self-send (real transaction, small amount)
// ============================================================================

describe('send (real self-send)', () => {
  it.skipIf(!process.env.VAULT_PASSWORD)(
    'sends a tiny RUNE amount to own address',
    async () => {
      // Derive own address so we never send to a hardcoded wallet
      const addrResult = await vsig('addresses')
      const addrData = expectOk(parseJson(addrResult))
      const selfAddress = addrData.addresses.THORChain

      // Self-send 0.01 RUNE — requires VAULT_PASSWORD env var
      const result = await vsig(
        'send',
        'THORChain',
        selfAddress,
        '0.01',
        '--yes',
        '--password',
        process.env.VAULT_PASSWORD!
      )
      const data = expectOk(parseJson(result))
      expect(data.txHash).toBeTruthy()
      expect(data.chain).toBe('THORChain')
      expect(typeof data.txHash).toBe('string')
      expect(data.explorerUrl).toContain(data.txHash)
    },
    60_000
  )
})

// ============================================================================
// Swap (dry-run + quote)
// ============================================================================

describe('swap', () => {
  it('swap-chains lists available swap chains', async () => {
    const result = await vsig('swap-chains')
    const data = expectOk(parseJson(result))
    expect(data.swapChains).toBeInstanceOf(Array)
    expect(data.swapChains.length).toBeGreaterThan(0)
    expect(data.swapChains).toContain('Bitcoin')
    expect(data.swapChains).toContain('Ethereum')
  })

  it(
    'swap-quote returns quote with fees',
    async () => {
      const result = await vsig('swap-quote', 'THORChain', 'Solana', '5')
      const data = expectOk(parseJson(result))
      expect(data.quote).toBeTruthy()
      expect(data.quote.provider).toBeTruthy()
      expect(data.quote.estimatedOutput).toBeTruthy()
      expect(data.quote.fromCoin.ticker).toBe('RUNE')
      expect(data.quote.toCoin.ticker).toBe('SOL')
    },
    TIMEOUT
  )

  it(
    'swap-quote fails with insufficient amount',
    async () => {
      const result = await vsig('swap-quote', 'THORChain', 'Solana', '0.001')
      const json = parseJson(result)
      expectError(json)
    },
    TIMEOUT
  )

  it(
    'swap --dry-run returns preview without executing',
    async () => {
      const result = await vsig('swap', 'THORChain', 'Solana', '5', '--dry-run')
      const data = expectOk(parseJson(result))
      expect(data.dryRun).toBe(true)
      expect(data.fromChain).toBe('THORChain')
      expect(data.fromToken).toBe('RUNE')
      expect(data.toChain).toBe('Solana')
      expect(data.toToken).toBe('SOL')
      expect(data.provider).toBeTruthy()
      expect(parseFloat(data.estimatedOutput)).toBeGreaterThan(0)
    },
    TIMEOUT
  )
})

// ============================================================================
// Error handling & exit codes
// ============================================================================

describe('error handling', () => {
  it('invalid chain returns structured error', async () => {
    const result = await vsig('balance', 'FakeChain')
    const json = parseJson(result)
    const err = expectError(json)
    expect(err.code).toBeTruthy()
    expect(typeof err.exitCode).toBe('number')
    expect(err.message).toMatch(/FakeChain/i)
  })

  it('unknown command returns non-zero exit', async () => {
    const result = await vsig('totally-fake-command')
    expect(result.code).not.toBe(0)
  })

  it('send to invalid address returns structured error', async () => {
    const result = await vsig('send', 'THORChain', 'not-an-address', '0.01')
    const json = parseJson(result)
    expect(json).toBeTruthy()
    expect(json.success).toBe(false)
  })
})

// ============================================================================
// Schema discovery
// ============================================================================

describe('schema', () => {
  it('schema returns machine-readable command introspection', async () => {
    const result = await new Promise<ExecResult>(resolve => {
      execFile('node', [CLI, 'schema'], { timeout: TIMEOUT }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as any)?.code ?? 0 })
      })
    })
    const schema = JSON.parse(result.stdout)
    expect(schema.name).toBe('vultisig')
    expect(schema.version).toBeTruthy()
    expect(schema.exitCodes).toBeTruthy()
    expect(schema.commands).toBeInstanceOf(Array)
    expect(schema.commands.length).toBeGreaterThan(10)
    expect(schema.globalOptions).toBeInstanceOf(Array)
  })

  it('schema includes examples for key commands', async () => {
    const result = await new Promise<ExecResult>(resolve => {
      execFile('node', [CLI, 'schema'], { timeout: TIMEOUT }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as any)?.code ?? 0 })
      })
    })
    const schema = JSON.parse(result.stdout)
    const balance = schema.commands.find((c: any) => c.name === 'balance')
    expect(balance).toBeTruthy()
    expect(balance.examples).toBeTruthy()
    const send = schema.commands.find((c: any) => c.name === 'send')
    expect(send).toBeTruthy()
    expect(send.examples).toBeTruthy()
  })

  it('schema command is hidden from --help', async () => {
    const result = await new Promise<ExecResult>(resolve => {
      execFile('node', [CLI, '--help'], { timeout: TIMEOUT }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as any)?.code ?? 0 })
      })
    })
    expect(result.stdout).not.toContain('schema')
  })
})

// ============================================================================
// Version & misc
// ============================================================================

describe('misc', () => {
  it('--version returns version string', async () => {
    const result = await new Promise<ExecResult>(resolve => {
      execFile('node', [CLI, '--version'], { timeout: TIMEOUT }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as any)?.code ?? 0 })
      })
    })
    expect(result.stdout.trim()).toMatch(/^vultisig\/\d+\.\d+\.\d+/)
  })

  it(
    'discount shows VULT discount tier',
    async () => {
      const result = await vsig('discount')
      const data = expectOk(parseJson(result))
      expect(data).toBeTruthy()
    },
    TIMEOUT
  )

  it('currency shows current fiat currency', async () => {
    // currency command outputs text, not JSON — just verify it runs successfully
    const result = await new Promise<ExecResult>(resolve => {
      execFile('node', [CLI, 'currency'], { timeout: TIMEOUT }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as any)?.code ?? 0 })
      })
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Currency')
  })
})
