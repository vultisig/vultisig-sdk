import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type AgentTokenCacheScope = {
  publicKey: string
  backendUrl: string
  profile?: string
}

export type TokenEntry = { token: string; expiresAt: number; refreshToken?: string }
type TokenStore = Record<string, TokenEntry>

const LOCK_RETRY_MS = 25
const LOCK_MAX_WAIT_MS = 5_000
const LOCK_STALE_MS = 30_000

export function getTokenCachePath(): string {
  const dir = process.env.VULTISIG_CONFIG_DIR ?? join(homedir(), '.vultisig')
  return join(dir, 'agent-tokens.json')
}

/** A token is valid only for the exact vault/backend/profile tuple that minted it. */
export function tokenCacheKey(scope: AgentTokenCacheScope): string {
  return JSON.stringify([scope.publicKey, scope.backendUrl.replace(/\/+$/, ''), scope.profile ?? ''])
}

function readTokenStore(): TokenStore {
  try {
    const path = getTokenCachePath()
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as TokenStore) : {}
  } catch {
    return {}
  }
}

function ensurePrivateDirectory(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {
    // Best-effort on filesystems without POSIX permissions.
  }
}

function writeTokenStoreAtomic(store: TokenStore): void {
  const path = getTokenCachePath()
  ensurePrivateDirectory(path)
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`
  try {
    writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600, flag: 'wx' })
    try {
      chmodSync(tmp, 0o600)
    } catch {
      // Best-effort on filesystems without POSIX permissions.
    }
    renameSync(tmp, path)
  } finally {
    rmSync(tmp, { force: true })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cleanStaleLock(lockPath: string): boolean {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs <= LOCK_STALE_MS) return false
    rmSync(lockPath, { force: true })
    return true
  } catch {
    return !existsSync(lockPath)
  }
}

async function acquireTokenStoreLock(): Promise<() => void> {
  const path = getTokenCachePath()
  ensurePrivateDirectory(path)
  const lockPath = `${path}.lock`
  const token = `${process.pid}:${Date.now()}:${randomUUID()}`
  const startedAt = Date.now()

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        writeFileSync(fd, token)
      } finally {
        closeSync(fd)
      }
      return () => {
        try {
          if (readFileSync(lockPath, 'utf8') === token) rmSync(lockPath, { force: true })
        } catch {
          // Already released or replaced after a stale-lock cleanup.
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (cleanStaleLock(lockPath)) continue
      if (Date.now() - startedAt >= LOCK_MAX_WAIT_MS) {
        throw new Error(`Timed out waiting for agent token-cache lock: ${lockPath}`)
      }
      await sleep(LOCK_RETRY_MS)
    }
  }
}

async function mutateTokenStore(mutator: (store: TokenStore) => void): Promise<void> {
  const release = await acquireTokenStoreLock()
  try {
    const store = readTokenStore()
    mutator(store)
    writeTokenStoreAtomic(store)
  } finally {
    release()
  }
}

export function getCachedTokenEntry(scope: AgentTokenCacheScope): TokenEntry | undefined {
  return readTokenStore()[tokenCacheKey(scope)]
}

/** Load a token only when it remains valid for at least another minute. */
export async function loadCachedToken(scope: AgentTokenCacheScope): Promise<string | null> {
  const key = tokenCacheKey(scope)
  const entry = readTokenStore()[key]
  if (!entry) return null

  const expiresMs = entry.expiresAt * (entry.expiresAt < 1e12 ? 1000 : 1)
  if (Date.now() < expiresMs - 60_000) return entry.token

  // Delete only the stale value we observed. A sibling may have refreshed this
  // scope while we waited for the lock; never erase that newer token.
  await mutateTokenStore(store => {
    const current = store[key]
    if (current?.token === entry.token && current.expiresAt === entry.expiresAt) delete store[key]
  })
  return null
}

export async function saveCachedToken(
  scope: AgentTokenCacheScope,
  token: string,
  expiresAt: number,
  refreshToken?: string
): Promise<void> {
  const key = tokenCacheKey(scope)
  await mutateTokenStore(store => {
    store[key] = {
      token,
      expiresAt,
      refreshToken: refreshToken ?? store[key]?.refreshToken,
    }
  })
}

export async function clearCachedToken(scope: AgentTokenCacheScope): Promise<void> {
  const key = tokenCacheKey(scope)
  await mutateTokenStore(store => {
    delete store[key]
  })
}
