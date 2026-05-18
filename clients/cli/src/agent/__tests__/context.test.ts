import type { VaultBase } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import { buildMessageContext, buildMinimalContext } from '../context'

/**
 * Minimal VaultBase stand-in. `buildMessageContext` wraps address/balance/coin
 * gathering in try/catch, so an empty `chains` list keeps those side branches
 * quiet and lets the tests focus on `chain_public_keys` threading.
 */
function mockVault(chainPublicKeys?: Record<string, string | undefined>): VaultBase {
  return {
    name: 'test-vault',
    publicKeys: { ecdsa: '0xecdsa', eddsa: '0xeddsa' },
    publicKeyMldsa: '0xmldsa',
    chains: [],
    tokens: {},
    data: { chainPublicKeys },
    address: async () => '',
    balances: async () => ({}),
  } as unknown as VaultBase
}

describe('buildMessageContext — chain_public_keys', () => {
  it('forwards a vault that has chain_public_keys', async () => {
    const ctx = await buildMessageContext(
      mockVault({ Solana: 'sol-pub', Terra: 'terra-pub' })
    )
    expect(ctx.chain_public_keys).toEqual({ Solana: 'sol-pub', Terra: 'terra-pub' })
  })

  it('omits the field when the vault has no chainPublicKeys', async () => {
    const ctx = await buildMessageContext(mockVault(undefined))
    expect(ctx.chain_public_keys).toBeUndefined()
    expect('chain_public_keys' in ctx).toBe(false)
  })

  it('omits the field for an empty chainPublicKeys map (no empty {})', async () => {
    const ctx = await buildMessageContext(mockVault({}))
    expect(ctx.chain_public_keys).toBeUndefined()
  })

  it('drops chains with undefined/empty pubkeys', async () => {
    const ctx = await buildMessageContext(
      mockVault({ Solana: 'sol-pub', Sui: undefined, Polkadot: '' })
    )
    expect(ctx.chain_public_keys).toEqual({ Solana: 'sol-pub' })
  })

  it('serializes to the agent-backend wire shape (nested in context)', async () => {
    const ctx = await buildMessageContext(mockVault({ Solana: 'sol-pub' }))
    const body = JSON.parse(JSON.stringify({ public_key: '0xpk', content: 'hi', context: ctx }))
    expect(body.context.chain_public_keys).toEqual({ Solana: 'sol-pub' })
  })
})

describe('buildMinimalContext — chain_public_keys', () => {
  it('forwards chain_public_keys too (parity with full context)', async () => {
    const ctx = await buildMinimalContext(mockVault({ Solana: 'sol-pub' }))
    expect(ctx.chain_public_keys).toEqual({ Solana: 'sol-pub' })
  })

  it('omits the field when the vault has none', async () => {
    const ctx = await buildMinimalContext(mockVault(undefined))
    expect(ctx.chain_public_keys).toBeUndefined()
  })
})
