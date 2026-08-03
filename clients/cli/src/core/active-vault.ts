/**
 * Tolerant read of the stored active-vault pointer.
 *
 * The active vault is tracked in `~/.vultisig/activeVaultId.json`. If that file
 * is truncated, hand-edited, or otherwise unparseable, the underlying storage
 * `get()` throws instead of returning a value — and because the pointer is read
 * during CLI startup (before any command runs), a single corrupt pointer file
 * bricks EVERY command, including `vaults`, the one an operator reaches for to
 * diagnose and recover. Listing vaults does not logically need the pointer.
 *
 * So the POINTER read fails open here, mirroring the broadcast journal: a corrupt
 * pointer is treated as "no active vault" rather than a fatal error, and we
 * self-heal by clearing it (best-effort) so the corruption doesn't resurface.
 * The tolerance is deliberately scoped to the pointer read ONLY — resolving the
 * vault the (valid) pointer names is left un-guarded so a genuine error loading
 * that vault's data still surfaces instead of being silently swallowed and the
 * good pointer wrongly deleted. Vault key material lives in separate files and
 * is never touched.
 */
import type { VaultBase, Vultisig } from '@vultisig/sdk'

/** Storage key holding the id of the active vault. */
const ACTIVE_VAULT_ID_KEY = 'activeVaultId'

export type SafeActiveVault = {
  /** The resolved active vault, or `null` when there is none / the pointer was corrupt. */
  vault: VaultBase | null
  /**
   * `true` when the stored pointer was unreadable/unparseable and the fail-open
   * path was taken. Callers use this to avoid silently substituting a different
   * vault (e.g. auto-selecting one) off the back of a corrupt pointer.
   */
  corruptPointer: boolean
}

/**
 * Load the stored active vault, tolerating only a corrupt/unreadable pointer.
 *
 * Never throws for a corrupt pointer. Still throws if the pointer is readable
 * but the vault it names fails to load — that is a real, different error.
 */
export async function loadActiveVaultSafely(sdk: Vultisig): Promise<SafeActiveVault> {
  let activeId: string | null
  try {
    activeId = await sdk.storage.get<string>(ACTIVE_VAULT_ID_KEY)
  } catch (err) {
    // Fail open: a corrupt active pointer must not block access to vaults.
    process.stderr.write(
      `Warning: active vault pointer is unreadable and was ignored (no active vault). ${(err as Error)?.message ?? ''}\n`
    )
    // Self-heal: clear the bad pointer so it doesn't keep failing. Best-effort —
    // never let cleanup turn a tolerated read back into a fatal error.
    try {
      await sdk.setActiveVault(null)
    } catch {
      // ignore — the read already succeeded logically as "no active vault"
    }
    return { vault: null, corruptPointer: true }
  }

  if (activeId === null || activeId === undefined) {
    return { vault: null, corruptPointer: false }
  }

  // Resolve the named vault WITHOUT swallowing: a corrupt vault-data file or a
  // transient storage error here is a real failure that must surface.
  return { vault: await sdk.getVaultById(activeId), corruptPointer: false }
}

/**
 * Whether the interactive shell should promote the first loaded vault to active
 * when no active vault is set.
 *
 * Deliberately returns `false` when the stored pointer was corrupt: auto-selecting
 * a vault off the back of a lost selection would let a later send/sign run against
 * a vault the user never chose, so we make them pick one explicitly instead.
 */
export function shouldAutoSelectActiveVault(
  hasActiveVault: boolean,
  corruptPointer: boolean,
  vaultCount: number
): boolean {
  return !hasActiveVault && !corruptPointer && vaultCount > 0
}
