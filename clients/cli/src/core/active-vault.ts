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
 * So reads FAIL OPEN here, mirroring the broadcast journal: a corrupt pointer is
 * treated as "no active vault" rather than a fatal error. We also self-heal by
 * clearing the bad pointer (best-effort) so the corruption doesn't resurface on
 * the next run. Vault data lives in separate files and is never touched.
 */
import type { VaultBase, Vultisig } from '@vultisig/sdk'

/**
 * Load the stored active vault, tolerating a corrupt/unreadable pointer.
 *
 * @returns the active vault, or `null` when there is none OR the pointer could
 *   not be read. Never throws for a corrupt pointer.
 */
export async function loadActiveVaultSafely(sdk: Vultisig): Promise<VaultBase | null> {
  try {
    return await sdk.getActiveVault()
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
    return null
  }
}
