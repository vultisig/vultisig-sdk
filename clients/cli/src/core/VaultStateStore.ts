/**
 * VaultStateStore — vault-keyed local store with per-chain file locking.
 *
 * Provides cross-process serialization for chain state that must not be
 * used concurrently (EVM nonces, UTXO selection, Cosmos sequences, etc.).
 *
 * Design:
 *   - Storage dir: ~/.vultisig/vault-state/<vaultId>/
 *   - Lock files:  <chain>.lock   (atomic O_CREAT|O_EXCL)
 *   - State files:  <chain>.state.json
 *   - Always uses max(onChainValue, localValue) so external txs are respected.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EvmChainState = {
  /** The last nonce we successfully broadcast with */
  lastUsedNonce: string
  /** Epoch ms when this was recorded */
  updatedAt: number
}

type LockInfo = {
  pid: number
  timestamp: number
  token?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lock is considered stale after this many ms (protects against crashes) */
const LOCK_STALE_MS = 60_000

/** Initial retry delay when waiting for a held lock */
const LOCK_RETRY_INIT_MS = 100

/** Maximum total time to wait for a lock before throwing */
const LOCK_MAX_WAIT_MS = 30_000

/** State entries older than this are ignored (txs have surely confirmed) */
const STATE_TTL_MS = 10 * 60_000 // 10 minutes

// ---------------------------------------------------------------------------
// VaultStateStore
// ---------------------------------------------------------------------------

export class VaultStateStore {
  private readonly baseDir: string

  constructor(vaultId: string) {
    // Use first 40 hex chars of the ECDSA pubkey as dir name
    const safeId = vaultId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)
    if (!safeId) {
      throw new Error('Invalid vaultId: must contain alphanumeric characters')
    }
    this.baseDir = path.join(os.homedir(), '.vultisig', 'vault-state', safeId)
    fs.mkdirSync(this.baseDir, { recursive: true })
  }

  // -------------------------------------------------------------------------
  // Chain-level locking
  // -------------------------------------------------------------------------

  /**
   * Acquire an exclusive file lock for the given chain.
   * Blocks (with exponential backoff) until the lock is available or timeout.
   *
   * @returns A release function — caller MUST call it when done.
   */
  async acquireChainLock(chain: string): Promise<() => Promise<void>> {
    const lockPath = path.join(this.baseDir, `${chain}.lock`)
    const startTime = Date.now()
    let delay = LOCK_RETRY_INIT_MS

    while (true) {
      try {
        // Atomic exclusive create — fails with EEXIST if lock is held
        const fd = fs.openSync(lockPath, 'wx')
        const lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const info: LockInfo = { pid: process.pid, timestamp: Date.now(), token: lockToken }
        fs.writeSync(fd, JSON.stringify(info))
        fs.closeSync(fd)

        // Return the release function — only deletes if we still own the lock
        return async () => {
          try {
            const content = fs.readFileSync(lockPath, 'utf8')
            const current: LockInfo = JSON.parse(content)
            if (current.token === lockToken) {
              fs.unlinkSync(lockPath)
            }
          } catch {
            // Already released or cleaned up — fine
          }
        }
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err

        // Lock file exists — check if it's stale
        if (this.tryCleanStaleLock(lockPath)) {
          continue // Removed stale lock, retry immediately
        }

        // Lock is legitimately held — wait and retry
        if (Date.now() - startTime > LOCK_MAX_WAIT_MS) {
          throw new Error(
            `Timeout after ${LOCK_MAX_WAIT_MS}ms waiting for ${chain} chain lock. ` +
            `Another process may be stuck. Lock file: ${lockPath}`
          )
        }

        await sleep(delay)
        delay = Math.min(delay * 1.5, 2_000) // Cap backoff at 2s
      }
    }
  }

  // -------------------------------------------------------------------------
  // EVM nonce management
  // -------------------------------------------------------------------------

  /**
   * Get the next nonce to use for an EVM chain.
   *
   * Takes the on-chain nonce (from `getTransactionCount`) and returns
   * `max(onChainNonce, localLastUsed + 1)`. This ensures that:
   *   - Locally queued txs get incrementing nonces
   *   - External txs (MetaMask, other wallets) are respected
   *
   * MUST be called while holding the chain lock.
   */
  getNextEvmNonce(chain: string, onChainNonce: bigint): bigint {
    const state = this.readEvmState(chain)
    if (!state) return onChainNonce

    // Ignore stale state — the txs have confirmed and RPC is authoritative
    if (Date.now() - state.updatedAt > STATE_TTL_MS) return onChainNonce

    const localNext = BigInt(state.lastUsedNonce) + 1n
    return localNext > onChainNonce ? localNext : onChainNonce
  }

  /**
   * Clear persisted nonce state for a chain (e.g. when pending txs were evicted).
   */
  clearEvmState(chain: string): void {
    const filePath = path.join(this.baseDir, `${chain}.state.json`)
    try {
      fs.unlinkSync(filePath)
    } catch {
      // Already absent
    }
  }

  /**
   * Record that we broadcast a tx using the given nonce.
   * For approve+swap flows, pass the HIGHEST nonce used.
   *
   * MUST be called while holding the chain lock (before releasing).
   */
  recordEvmNonce(chain: string, nonce: bigint): void {
    const state: EvmChainState = {
      lastUsedNonce: nonce.toString(),
      updatedAt: Date.now(),
    }
    this.writeEvmState(chain, state)
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private readEvmState(chain: string): EvmChainState | null {
    const filePath = path.join(this.baseDir, `${chain}.state.json`)
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content) as EvmChainState
    } catch {
      return null
    }
  }

  private writeEvmState(chain: string, state: EvmChainState): void {
    const filePath = path.join(this.baseDir, `${chain}.state.json`)
    const tmpPath = filePath + `.tmp.${process.pid}`
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2))
    fs.renameSync(tmpPath, filePath) // Atomic on same filesystem
  }

  /**
   * Check if a lock file is stale and remove it if so.
   * @returns true if a stale lock was removed.
   */
  private tryCleanStaleLock(lockPath: string): boolean {
    try {
      const content = fs.readFileSync(lockPath, 'utf8')
      const info: LockInfo = JSON.parse(content)
      if (Date.now() - info.timestamp > LOCK_STALE_MS) {
        fs.unlinkSync(lockPath)
        return true
      }
    } catch {
      // Can't read/parse lock file — only remove if the file is old enough
      // to rule out a concurrent writer that hasn't finished writing yet
      try {
        const stat = fs.statSync(lockPath)
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath)
          return true
        }
      } catch {
        // File disappeared between read and stat — treat as released
        return true
      }
      return false
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
