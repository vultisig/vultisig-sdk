import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const warnMock = vi.fn()
const confirmTransactionMock = vi.fn()
const vaultSignBytesMock = vi.fn()
let nonInteractive = false

vi.mock('../lib/output', () => ({
  createSpinner: () => ({
    succeed: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    fail: vi.fn(),
    text: '',
  }),
  info: vi.fn(),
  warn: (...args: unknown[]) => warnMock(...args),
  isNonInteractive: () => nonInteractive,
  isJsonOutput: () => false,
  isSilent: () => false,
  outputJson: vi.fn(),
  printResult: vi.fn(),
}))
vi.mock('../ui', () => ({
  confirmTransaction: (...args: unknown[]) => confirmTransactionMock(...args),
}))
vi.mock('../core', () => ({
  ensureVaultUnlocked: vi.fn(),
}))

import { ConfirmationRequiredError } from '../core/errors'
import { signBytes } from './sign'

function makeVault(): VaultBase {
  return {
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    signBytes: vaultSignBytesMock,
  } as unknown as VaultBase
}

// bead vultisig-j2njo: the confirmation header must state the actual decoded
// length, not a hardcoded "32 bytes", because Buffer.from(x, 'base64') never
// throws on malformed input — it silently drops invalid characters.
describe('sign confirmation header reports the real decoded length', () => {
  beforeEach(() => {
    warnMock.mockClear()
    confirmTransactionMock.mockReset()
    vaultSignBytesMock.mockReset().mockResolvedValue({
      signature: 'deadbeef',
      format: 'ecdsa',
    })
    nonInteractive = false
  })

  it('requires --yes in non-interactive mode without prompting or signing', async () => {
    nonInteractive = true
    const payload = Buffer.alloc(32, 0xaa).toString('base64')

    await expect(signBytes(makeVault(), { chain: Chain.Ethereum, bytes: payload })).rejects.toBeInstanceOf(
      ConfirmationRequiredError
    )

    expect(confirmTransactionMock).not.toHaveBeenCalled()
    expect(vaultSignBytesMock).not.toHaveBeenCalled()
  })

  it('does not sign when confirmation is declined', async () => {
    confirmTransactionMock.mockResolvedValue(false)
    const payload = Buffer.alloc(32, 0xbb).toString('base64')

    await expect(signBytes(makeVault(), { chain: Chain.Ethereum, bytes: payload })).rejects.toBeInstanceOf(
      ConfirmationRequiredError
    )

    expect(confirmTransactionMock).toHaveBeenCalledOnce()
    expect(vaultSignBytesMock).not.toHaveBeenCalled()
  })

  it('signs with yes: true without prompting', async () => {
    nonInteractive = true
    const payload = Buffer.alloc(32, 0xcc).toString('base64')

    await expect(
      signBytes(makeVault(), { chain: Chain.Ethereum, bytes: payload, yes: true })
    ).resolves.toMatchObject({ format: 'ecdsa' })

    expect(confirmTransactionMock).not.toHaveBeenCalled()
    expect(vaultSignBytesMock).toHaveBeenCalledOnce()
  })

  it('reports the true decoded byte count for a non-32-byte payload, not a hardcoded 32', async () => {
    confirmTransactionMock.mockResolvedValue(true)
    // 55 raw bytes, base64-encoded — decodes cleanly but is NOT 32 bytes.
    const decoded = Buffer.alloc(55, 0xab)
    const payload = decoded.toString('base64')

    await signBytes(makeVault(), { chain: Chain.Ethereum, bytes: payload })

    const rendered = warnMock.mock.calls.map(call => String(call[0])).join('\n')
    expect(rendered).toContain('about to sign 55 bytes')
    expect(rendered).not.toContain('about to sign 32 bytes')
    expect(rendered).toContain(`Bytes:  0x${decoded.toString('hex')}`)
    expect(rendered).toContain('NOTE:   this is NOT a 32-byte digest (decoded 55 bytes)')
  })

  it('refuses to prompt on garbage input that decodes to an empty buffer', async () => {
    // Non-base64-alphabet garbage decodes to a 0-length buffer; there is
    // nothing for the operator to confirm, so this must hard-refuse rather
    // than render "Bytes: 0x" and let a confirm through.
    await expect(signBytes(makeVault(), { chain: Chain.Ethereum, bytes: '!!!!' })).rejects.toThrow(
      ConfirmationRequiredError
    )

    expect(confirmTransactionMock).not.toHaveBeenCalled()
  })

  it('states 32 bytes for an actual 32-byte digest, with no mismatch note', async () => {
    confirmTransactionMock.mockResolvedValue(true)
    const payload = Buffer.alloc(32, 0xcd).toString('base64')

    await signBytes(makeVault(), { chain: Chain.Ethereum, bytes: payload })

    const rendered = warnMock.mock.calls.map(call => String(call[0])).join('\n')
    expect(rendered).toContain('about to sign 32 bytes')
    expect(rendered).not.toContain('NOTE:')
  })
})
