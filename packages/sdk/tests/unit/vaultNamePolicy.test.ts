// Vault-name policy on rename (vultisig-sdk sdkcli2-13 P2-12).
//
// Regression guard: rename enforced an alphanumeric allowlist
// (/^[a-zA-Z0-9\s\-_]+$/) that rejected the `#` in ecosystem-created names like
// "Vultisig Cluster #1" — names creation and import both accept. That made rename a
// one-way door: rename away from such a name and you could never rename back.
// The policy now rejects only what is genuinely unsafe for the export filename the
// name is interpolated into: path separators and control characters.
import { describe, expect, it, vi } from 'vitest'

import { VaultBase } from '../../src/vault/VaultBase'

// export() base64-encodes the real key shares; stub only that side effect so the
// filename-construction logic runs for real against whatever metadata the vault carries.
vi.mock('../../src/utils/export', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/export')>()),
  createVaultBackup: vi.fn(async () => 'BASE64_BACKUP_DATA'),
}))

// validateVaultName is private; exercise it through the class the way rename() does.
function validate(name: string): { isValid: boolean; errors?: string[] } {
  return (
    VaultBase.prototype as unknown as {
      validateVaultName(name: string): { isValid: boolean; errors?: string[] }
    }
  ).validateVaultName(name)
}

describe('vault name policy', () => {
  it('accepts the ecosystem-created "#" name that rename used to reject', () => {
    expect(validate('Vultisig Cluster #1').isValid).toBe(true)
  })

  it('still accepts plain alphanumeric names', () => {
    for (const name of ['My Vault', 'vault-1', 'vault_2', 'Vault 3']) {
      expect(validate(name).isValid).toBe(true)
    }
  })

  it('accepts other printable punctuation the ecosystem may produce', () => {
    for (const name of ['Vault (main)', "Avran's Vault", 'Vault #2 — primary', 'Fund 100%']) {
      expect(validate(name).isValid).toBe(true)
    }
  })

  it('rejects path separators, which would escape the export filename', () => {
    expect(validate('../etc/passwd').isValid).toBe(false)
    expect(validate('a/b').errors).toContain('Vault name cannot contain path separators')
    expect(validate('a\\b').errors).toContain('Vault name cannot contain path separators')
  })

  it('rejects control characters', () => {
    expect(validate('bad\u0000name').errors).toContain('Vault name cannot contain control characters')
    expect(validate('bad\nname').errors).toContain('Vault name cannot contain control characters')
    expect(validate('bad\u007fname').errors).toContain('Vault name cannot contain control characters')
    // C1 range: U+009B is CSI, an escape introducer once the name is echoed to a terminal.
    expect(validate('bad\u009bname').errors).toContain('Vault name cannot contain control characters')
  })

  it('keeps the pre-existing length and emptiness rules', () => {
    expect(validate('').isValid).toBe(false)
    expect(validate('a').isValid).toBe(false)
    expect(validate('x'.repeat(500)).isValid).toBe(false)
  })
})

// The suite above reaches the private validator directly. Drive rename() itself too,
// so the policy can't pass here while the real one-way door stays shut.
describe('rename() end-to-end', () => {
  // rename() reads vaultData.name, writes vaultData/coreVault, then persists via
  // save(). Stub only persistence so the real validator + real rename() body run.
  function makeVault(initialName: string) {
    const vault = Object.create(VaultBase.prototype) as VaultBase
    Object.assign(vault, {
      vaultData: { name: initialName },
      coreVault: { name: initialName },
      save: vi.fn(async () => {}),
      emit: vi.fn(),
    })
    return vault
  }

  it('accepts the ecosystem-created "#" name it used to reject', async () => {
    const vault = makeVault('Old Name')

    await expect(vault.rename('Vultisig Cluster #1')).resolves.not.toThrow()
  })

  it('lets a vault renamed away from a "#" name be renamed back — the one-way door', async () => {
    const vault = makeVault('Vultisig Cluster #1')

    await vault.rename('Temporary Name')
    await expect(vault.rename('Vultisig Cluster #1')).resolves.not.toThrow()
  })

  it('still rejects a name carrying a path separator', async () => {
    const vault = makeVault('Old Name')

    await expect(vault.rename('../evil')).rejects.toThrow(/path separators/)
  })
})

// The rename validator only guards names set AFTER it existed. A vault imported, or
// created via a path that ran no name validation, can reach export() carrying an unsafe
// name or localPartyId — the real gap CodeRabbit flagged. export() must therefore encode
// every filename component (same policy as rename, but encoding instead of rejecting so a
// legitimately-imported vault is never stranded behind its own backup file).
describe('export() filename safety — pre-existing unsafe metadata', () => {
  // Build the unsafe characters programmatically so no raw control byte lives in source.
  const BACKSLASH = String.fromCharCode(0x5c)
  const NUL = String.fromCharCode(0x00)
  const LF = String.fromCharCode(0x0a)
  const CSI = String.fromCharCode(0x9b) // C1 control, a terminal escape introducer

  // export() lazy-loads shares then base64-encodes them; both are stubbed (share loading
  // here, encoding via the module mock above) so the real filename construction runs.
  function makeVault(name: string, localPartyId: string) {
    const vault = Object.create(VaultBase.prototype) as VaultBase
    Object.assign(vault, {
      vaultData: { name, localPartyId, signers: [localPartyId] },
      coreVault: {},
      ensureKeySharesLoaded: vi.fn(async () => {}),
    })
    return vault
  }

  const cases = [
    { label: 'forward-slash path separators', name: '../../etc/passwd', localPartyId: 'device-1' },
    { label: 'backslash path separators', name: `a${BACKSLASH}b`, localPartyId: `dev${BACKSLASH}ice` },
    { label: 'control characters (incl. C1 CSI)', name: `bad${NUL}${LF}name`, localPartyId: `dev${CSI}ice` },
    { label: 'a bare dot-dot component', name: '..', localPartyId: '..' },
  ]

  for (const { label, name, localPartyId } of cases) {
    it(`encodes ${label} into a safe single-component filename`, async () => {
      const { filename } = await makeVault(name, localPartyId).export()

      // Single path component: no separator survives anywhere in the filename.
      expect(filename.includes('/')).toBe(false)
      expect(filename.includes(BACKSLASH)).toBe(false)
      // No control character (C0 / DEL / C1) survives into the filename.
      const hasControlChar = [...filename].some(ch => {
        const code = ch.charCodeAt(0)
        return code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)
      })
      expect(hasControlChar).toBe(false)
      // No leading dot-run that could resolve to "." / ".." traversal.
      expect(filename.startsWith('.')).toBe(false)
      // The stable suffix stays intact, so the file is still a recognizable share backup.
      expect(filename.includes('share1of1')).toBe(true)
      expect(filename.endsWith('.vult')).toBe(true)
    })
  }

  it('replaces a component that encodes to empty with a placeholder, never a blank segment', async () => {
    // Exercises the `length > 0 ? encoded : '_'` fallback: a name that is empty, or is
    // ONLY unsafe characters, must still yield a real component — otherwise the filename
    // would begin with the "-" separator and lose a segment.
    for (const emptyish of ['', '/', String.fromCharCode(0x00)]) {
      const { filename } = await makeVault(emptyish, 'device-1').export()
      expect(filename).toBe('_-device-1-share1of1.vult')
    }
  })
})
