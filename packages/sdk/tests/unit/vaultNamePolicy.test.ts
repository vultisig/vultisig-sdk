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
