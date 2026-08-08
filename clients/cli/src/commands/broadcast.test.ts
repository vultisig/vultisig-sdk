/**
 * bead aq5ku + z3xkg: broadcast gates on --yes and pre-validates rawTx shape
 * before it reaches the network. The pre-validation regression (caught in
 * review): a blanket hex regex was applied to every chain, but broadcastRawTx
 * fans out per chain kind and only some families are hex-only. evm/utxo/
 * polkadot/bittensor/ripple are hex, while solana is base58-or-base64, cosmos
 * is base64 protobuf or a JSON tx_bytes envelope, sui is a JSON envelope, and
 * ton is a base64 BOC. The unscoped hex check rejected the non-hex families
 * as "Malformed raw transaction" even though they were perfectly valid signed
 * payloads for broadcastRawTx.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), start: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  warn: vi.fn(),
  isNonInteractive: vi.fn(() => false),
  isJsonOutput: () => false,
  isSilent: () => false,
  outputJson: vi.fn(),
  printResult: vi.fn(),
}))
vi.mock('../ui', () => ({
  confirmTransaction: vi.fn().mockResolvedValue(true),
}))

import type { CommandContext } from '../core'
import { ConfirmationRequiredError, InvalidInputError } from '../core/errors'
import { isNonInteractive, warn } from '../lib/output'
import { confirmTransaction } from '../ui'
import { executeBroadcast } from './broadcast'

function makeCtx(broadcastRawTx: (p: { chain: Chain; rawTx: string }) => Promise<string>): {
  ctx: CommandContext
  vault: VaultBase
} {
  const vault = {
    broadcastRawTx: vi.fn(broadcastRawTx),
  } as unknown as VaultBase

  return { ctx: { ensureActiveVault: async () => vault } as unknown as CommandContext, vault }
}

describe('executeBroadcast', () => {
  afterEach(() => {
    vi.mocked(isNonInteractive).mockReturnValue(false)
    vi.mocked(confirmTransaction).mockResolvedValue(true)
    vi.clearAllMocks()
  })

  it('non-interactive without --yes throws ConfirmationRequiredError and never broadcasts', async () => {
    vi.mocked(isNonInteractive).mockReturnValue(true)
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef' }).catch(e => e)

    expect(err).toBeInstanceOf(ConfirmationRequiredError)
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it('declining the interactive confirm throws ConfirmationRequiredError and never broadcasts', async () => {
    vi.mocked(confirmTransaction).mockResolvedValue(false)
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef' }).catch(e => e)

    expect(err).toBeInstanceOf(ConfirmationRequiredError)
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it('--yes skips confirmation and passes the raw tx straight through', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const result = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef', yes: true })

    expect(confirmTransaction).not.toHaveBeenCalled()
    expect(vault.broadcastRawTx).toHaveBeenCalledWith({ chain: Chain.Ethereum, rawTx: '0xdeadbeef' })
    expect(result.txHash).toBe('0xhash')
  })

  it('trims surrounding whitespace before broadcasting', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const result = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '  0xdeadbeef  ', yes: true })

    expect(vault.broadcastRawTx).toHaveBeenCalledWith({ chain: Chain.Ethereum, rawTx: '0xdeadbeef' })
    expect(result.txHash).toBe('0xhash')
  })

  it('empty rawTx throws InvalidInputError regardless of chain family', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Solana, rawTx: '   ', yes: true }).catch(e => e)

    expect(err).toBeInstanceOf(InvalidInputError)
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it('malformed hex on an EVM chain is rejected before broadcasting', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xnothex!!', yes: true }).catch(e => e)

    expect(err).toBeInstanceOf(InvalidInputError)
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it('malformed hex (odd length) on a UTXO chain is rejected before broadcasting', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Bitcoin, rawTx: '0xabc', yes: true }).catch(e => e)

    expect(err).toBeInstanceOf(InvalidInputError)
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it.each([Chain.Polkadot, Chain.Bittensor, Chain.Ripple])(
    'malformed hex on %s is rejected before broadcasting',
    async chain => {
      const { ctx, vault } = makeCtx(async () => '0xhash')

      const err = await executeBroadcast(ctx, { chain, rawTx: 'not-hex!!', yes: true }).catch(e => e)

      expect(err).toBeInstanceOf(InvalidInputError)
      expect(vault.broadcastRawTx).not.toHaveBeenCalled()
    }
  )

  it('escapes control characters in the confirmation preview for non-hex payloads', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    await executeBroadcast(ctx, { chain: Chain.THORChain, rawTx: 'CooBCog=\u001b[2J', yes: false })

    expect(vault.broadcastRawTx).toHaveBeenCalledWith({ chain: Chain.THORChain, rawTx: 'CooBCog=\u001b[2J' })
    expect(vi.mocked(warn)).toHaveBeenCalledWith('   Raw tx: CooBCog=\\x1b[2J (12 chars)')
  })

  // The regression test: before the review fix, the hex-only regex was applied
  // unconditionally to every chain family. Each of these is a legitimate signed
  // payload for its own chain and must reach broadcastRawTx, not get rejected
  // as "Malformed raw transaction".
  it.each([
    { chain: Chain.Solana, rawTx: '3Bxs4h24hBtQy9vC3btSp1ELPQXe6L6ojKmVKf6b5BR8k6t' }, // base58
    { chain: Chain.Solana, rawTx: 'AQAB//8gYWJjZGVmZ2hpams=' }, // base64
    { chain: Chain.THORChain, rawTx: 'CooBCogBChwvY29zbW9zLmJhbmsudjFiZXRhMS5Nc2dTZW5k' }, // cosmos base64 protobuf
    { chain: Chain.THORChain, rawTx: '{"tx_bytes":"CooBCog=","mode":"BROADCAST_MODE_SYNC"}' }, // cosmos JSON envelope
    { chain: Chain.Sui, rawTx: '{"unsignedTx":"AAAB","signature":"AQID"}' }, // sui JSON envelope
    { chain: Chain.Tron, rawTx: '{"txID":"abc","raw_data_hex":"deadbeef"}' }, // tron JSON envelope
    { chain: Chain.Ton, rawTx: 'te6cckEBAQEAAgAAAEysuc0=' }, // ton base64 BOC
  ])('non-hex family payload for $chain is NOT rejected by the shape check', async ({ chain, rawTx }) => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const result = await executeBroadcast(ctx, { chain, rawTx, yes: true })

    expect(vault.broadcastRawTx).toHaveBeenCalledWith({ chain, rawTx })
    expect(result.txHash).toBe('0xhash')
  })
})
