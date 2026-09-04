/**
 * `buildAndSignSolanaSwapLocally` used to reconstruct a human-readable
 * decimal amount from the backend tx envelope's base-units `amount` (via
 * `formatUnits(BigInt(amountStr), fromDecimals)`) purely to hand it to
 * `vault.getSwapQuote` / `vault.prepareSwapTx`, which then re-derived the
 * same base-units value internally. architecture#2080: the envelope's
 * base-units amount is now forwarded directly via `amountBaseUnits`, so
 * this local decimal reconstruction is gone.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Solana],
    isEncrypted: false,
    getSwapQuote: vi.fn().mockResolvedValue({
      quote: { quote: { general: {} }, expiresAt: Date.now() + 60_000 },
      estimatedOutput: 1n,
      provider: 'jupiter',
      expiresAt: Date.now() + 60_000,
      requiresApproval: false,
      fees: { network: 0n, total: 0n },
      warnings: [],
      fromCoin: { chain: Chain.Solana, ticker: 'SOL', decimals: 9 },
      toCoin: { chain: Chain.Solana, ticker: 'USDC', decimals: 6 },
      balance: 0n,
      maxSwapable: 0n,
    }),
    prepareSwapTx: vi.fn().mockResolvedValue({
      keysignPayload: { __mockPayload: true },
      quote: {},
    }),
    extractMessageHashes: vi.fn().mockResolvedValue(['0xmessage']),
    sign: vi.fn().mockResolvedValue({ __mockSignature: true }),
    broadcastTx: vi.fn().mockResolvedValue('solTxHashHere'),
  } as unknown as VaultBase
}

describe('AgentExecutor — buildAndSignSolanaSwapLocally amount handling', () => {
  it('forwards the envelope base-units amount directly, without a decimal round trip', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const serverTxData = {
      from_chain: 'Solana',
      to_chain: 'Solana',
      amount: '1500000000', // 1.5 SOL in lamports
      from_address: undefined,
      to_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    }

    // Private method — reached directly since the full `signTxFromBuffer`
    // dispatch (chain==='Solana' && (swap_tx || provider)) needs a much
    // larger fixture unrelated to what this regression pins: the amount
    // resolution inside this specific builder.
    const result = await (
      executor as unknown as { buildAndSignSolanaSwapLocally: (d: unknown) => Promise<unknown> }
    ).buildAndSignSolanaSwapLocally(serverTxData)

    expect(vault.getSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ amountBaseUnits: 1_500_000_000n }))
    expect(vault.getSwapQuote).toHaveBeenCalledWith(expect.not.objectContaining({ amount: expect.anything() }))
    expect(vault.prepareSwapTx).toHaveBeenCalledWith(
      expect.objectContaining({ amountBaseUnits: 1_500_000_000n, autoApprove: true })
    )
    expect(result).toMatchObject({ tx_hash: 'solTxHashHere', chain: 'Solana', status: 'pending' })
  })

  it('rejects a non-numeric amount instead of silently defaulting', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const serverTxData = {
      from_chain: 'Solana',
      to_chain: 'Solana',
      amount: 'not-a-number',
    }

    await expect(
      (
        executor as unknown as { buildAndSignSolanaSwapLocally: (d: unknown) => Promise<unknown> }
      ).buildAndSignSolanaSwapLocally(serverTxData)
    ).rejects.toThrow(/Invalid amount in tx_ready data for local Solana swap build/)
    expect(vault.getSwapQuote).not.toHaveBeenCalled()
  })
})
