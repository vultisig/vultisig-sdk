/**
 * Version Management for Vultisig CLI
 *
 * Provides version display and update checking functionality
 */
import chalk from 'chalk'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Package version (will be replaced during build or read from package.json)
let cachedVersion: string | null = null

/**
 * Get the current CLI version
 */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion

  try {
    // Try to read from package.json in the installed location
    const packagePath = new URL('../../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
    cachedVersion = pkg.version
    return cachedVersion!
  } catch {
    // Fallback version
    cachedVersion = '0.1.0-beta.1'
    return cachedVersion
  }
}

/**
 * Version check cache info
 */
interface VersionCache {
  lastCheck: number
  latestVersion: string | null
}

const CACHE_DIR = join(homedir(), '.vultisig', 'cache')
const VERSION_CACHE_FILE = join(CACHE_DIR, 'version-check.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Read version cache
 */
function readVersionCache(): VersionCache | null {
  try {
    if (!existsSync(VERSION_CACHE_FILE)) return null
    const data = readFileSync(VERSION_CACHE_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * Write version cache
 */
function writeVersionCache(cache: VersionCache): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }
    writeFileSync(VERSION_CACHE_FILE, JSON.stringify(cache, null, 2))
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Check npm registry for latest version
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch('https://registry.npmjs.org/@vultisig/cli/latest', {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    clearTimeout(timeout)

    if (!response.ok) return null

    const data = (await response.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

/**
 * Compare semantic versions
 * Returns true if v2 is newer than v1
 */
function isNewerVersion(v1: string, v2: string): boolean {
  const parse = (v: string) => {
    // Remove 'v' prefix and beta/alpha suffixes for comparison
    const clean = v.replace(/^v/, '').replace(/-.*$/, '')
    return clean.split('.').map(n => parseInt(n, 10) || 0)
  }

  const p1 = parse(v1)
  const p2 = parse(v2)

  for (let i = 0; i < 3; i++) {
    const n1 = p1[i] ?? 0
    const n2 = p2[i] ?? 0
    if (n2 > n1) return true
    if (n2 < n1) return false
  }

  // Check if v2 is stable while v1 is beta/alpha
  if (v1.includes('-') && !v2.includes('-')) return true

  return false
}

/**
 * Check for updates (non-blocking, returns immediately if cached)
 */
export async function checkForUpdates(): Promise<{
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
} | null> {
  // Skip if update check is disabled
  if (process.env.VULTISIG_NO_UPDATE_CHECK === '1') {
    return null
  }

  const currentVersion = getVersion()
  const cache = readVersionCache()

  // Use cached result if still valid
  if (cache && Date.now() - cache.lastCheck < CACHE_TTL_MS) {
    return {
      currentVersion,
      latestVersion: cache.latestVersion,
      updateAvailable: cache.latestVersion ? isNewerVersion(currentVersion, cache.latestVersion) : false,
    }
  }

  // Fetch in background, don't block
  const latestVersion = await fetchLatestVersion()

  // Update cache
  writeVersionCache({
    lastCheck: Date.now(),
    latestVersion,
  })

  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion ? isNewerVersion(currentVersion, latestVersion) : false,
  }
}

/**
 * Print update notification if available
 */
export async function printUpdateNotification(): Promise<void> {
  try {
    const result = await checkForUpdates()
    if (result?.updateAvailable && result.latestVersion) {
      console.log()
      console.log(chalk.yellow(`Update available: ${result.currentVersion} -> ${result.latestVersion}`))
      console.log(chalk.gray(`Run "vultisig update" or "npm update -g @vultisig/cli" to update`))
      console.log()
    }
  } catch {
    // Silently ignore update check failures
  }
}

/**
 * Format version output for --version flag
 */
export function formatVersionShort(): string {
  return `vultisig/${getVersion()}`
}

/**
 * Format detailed version output for 'version' command
 */
export function formatVersionDetailed(): string {
  const lines: string[] = []

  lines.push(chalk.bold(`Vultisig CLI v${getVersion()}`))
  lines.push('')
  lines.push(`  Node.js:   ${process.version}`)
  lines.push(`  Platform:  ${process.platform}-${process.arch}`)
  lines.push(`  Config:    ~/.vultisig/`)

  return lines.join('\n')
}

/**
 * Detect installation method
 */
export type InstallMethod = 'npm' | 'yarn' | 'homebrew' | 'binary' | 'unknown'

export function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath

  if (execPath.includes('homebrew') || execPath.includes('Cellar')) {
    return 'homebrew'
  }

  if (process.env.npm_execpath?.includes('yarn')) {
    return 'yarn'
  }

  if (process.env.npm_config_user_agent?.includes('npm')) {
    return 'npm'
  }

  // Check if running from global npm/yarn
  if (execPath.includes('node_modules')) {
    return 'npm'
  }

  return 'unknown'
}

/**
 * Get update command for detected install method
 */
export function getUpdateCommand(): string {
  const method = detectInstallMethod()

  switch (method) {
    case 'npm':
      return 'npm update -g @vultisig/cli'
    case 'yarn':
      return 'yarn global upgrade @vultisig/cli'
    case 'homebrew':
      return 'brew upgrade vultisig'
    default:
      return 'npm update -g @vultisig/cli'
  }
}
