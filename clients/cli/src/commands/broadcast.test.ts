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
  isJsonOutput: vi.fn(() => false),
  isSilent: vi.fn(() => false),
  outputJson: vi.fn(),
  printResult: vi.fn(),
}))
vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>()
  return {
    ...actual,
    confirmTransaction: vi.fn().mockResolvedValue(true),
  }
})

import type { CommandContext } from '../core'
import { ConfirmationRequiredError, InvalidInputError } from '../core/errors'
import { isJsonOutput, isNonInteractive, isSilent, printResult } from '../lib/output'
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
    vi.mocked(isJsonOutput).mockReturnValue(false)
    vi.mocked(isSilent).mockReturnValue(false)
    vi.mocked(confirmTransaction).mockResolvedValue(true)
    vi.clearAllMocks()
  })

  it('non-interactive without --yes throws ConfirmationRequiredError and never broadcasts', async () => {
    vi.mocked(isNonInteractive).mockReturnValue(true)
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef' }).catch(e => e)

    expect(err).toBeInstanceOf(ConfirmationRequiredError)
    expect((err as ConfirmationRequiredError).hint).toContain('--yes')
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it('declining the interactive confirm throws ConfirmationRequiredError and never broadcasts', async () => {
    vi.mocked(confirmTransaction).mockResolvedValue(false)
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef' }).catch(e => e)

    expect(err).toBeInstanceOf(ConfirmationRequiredError)
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
    // Proves the gate actually calls confirmTransaction (paired with the --yes
    // test below, which proves it does NOT) — together they show --yes is what
    // skips the call, not that the call was never wired up.
    expect(confirmTransaction).toHaveBeenCalledTimes(1)
  })

  // REVIEW FIX (blocking 1): --output json / --silent both suppress warn()-based
  // output, but on a TTY isNonInteractive() is still false — so without this gate,
  // confirmTransaction() would fire a bare, context-free inquirer prompt and its
  // own output would contaminate the promised clean JSON stdout. Refuse up-front
  // instead of ever reaching confirmTransaction().
  it('json output without --yes throws ConfirmationRequiredError and never prompts or broadcasts', async () => {
    vi.mocked(isJsonOutput).mockReturnValue(true)
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef' }).catch(e => e)

    expect(err).toBeInstanceOf(ConfirmationRequiredError)
    expect((err as ConfirmationRequiredError).hint).toContain('--yes')
    expect(confirmTransaction).not.toHaveBeenCalled()
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it('silent mode without --yes throws ConfirmationRequiredError and never prompts or broadcasts', async () => {
    vi.mocked(isSilent).mockReturnValue(true)
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef' }).catch(e => e)

    expect(err).toBeInstanceOf(ConfirmationRequiredError)
    expect(confirmTransaction).not.toHaveBeenCalled()
    expect(vault.broadcastRawTx).not.toHaveBeenCalled()
  })

  it('json output WITH --yes broadcasts without touching the confirmation gate', async () => {
    vi.mocked(isJsonOutput).mockReturnValue(true)
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const result = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef', yes: true })

    expect(confirmTransaction).not.toHaveBeenCalled()
    expect(vault.broadcastRawTx).toHaveBeenCalledWith({ chain: Chain.Ethereum, rawTx: '0xdeadbeef' })
    expect(result.txHash).toBe('0xhash')
  })

  it('--yes skips confirmation and passes the raw tx straight through', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const result = await executeBroadcast(ctx, { chain: Chain.Ethereum, rawTx: '0xdeadbeef', yes: true })

    // Paired with 'declining the interactive confirm' above: that test proves
    // confirmTransaction IS called without --yes, this proves it is NOT called
    // with --yes — together they prove --yes is what skips the gate, not that
    // the gate was deleted.
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

  // REVIEW FIX: the malformed-hex error interpolated the raw (unescaped) input
  // into its message. A control character in that echoed slice would render
  // identically to a real terminal escape sequence when printed.
  it('escapes control characters in the malformed-hex error message', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')

    const err = await executeBroadcast(ctx, {
      chain: Chain.Ethereum,
      rawTx: 'not\u001b[2Jhex!!',
      yes: true,
    }).catch(e => e)

    expect(err).toBeInstanceOf(InvalidInputError)
    expect((err as InvalidInputError).message).toContain('not\\x1B[2Jhex!!')
    expect((err as InvalidInputError).message).not.toContain('\u001b')
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
    expect(vi.mocked(printResult)).toHaveBeenCalledWith('   Raw tx: CooBCog=\\x1B[2J (12 chars)')
  })

  // REVIEW FIX: the only prior preview test used a 12-char payload, so the
  // >44-char head+tail truncation branch (`shown.slice(0, 22)…shown.slice(-20)`)
  // had no coverage.
  it('truncates the confirmation preview for payloads longer than 44 chars', async () => {
    const { ctx, vault } = makeCtx(async () => '0xhash')
    const rawTx = 'a'.repeat(60)

    await executeBroadcast(ctx, { chain: Chain.THORChain, rawTx, yes: false })

    expect(vault.broadcastRawTx).toHaveBeenCalledWith({ chain: Chain.THORChain, rawTx })
    const expectedPreview = `${rawTx.slice(0, 22)}…${rawTx.slice(-20)}`
    expect(vi.mocked(printResult)).toHaveBeenCalledWith(`   Raw tx: ${expectedPreview} (60 chars)`)
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
