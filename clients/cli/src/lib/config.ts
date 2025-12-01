/**
 * Configuration Management for Vultisig CLI
 *
 * Handles CLI configuration files and environment variables
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * CLI Configuration
 */
export interface CLIConfig {
  version: number
  initialized: boolean
  initializedAt?: string
  preferences: {
    currency: string
    autoUpdate: boolean
    telemetry: boolean
    colorOutput: boolean
  }
  activeVault?: string
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CLIConfig = {
  version: 1,
  initialized: false,
  preferences: {
    currency: 'usd',
    autoUpdate: true,
    telemetry: false,
    colorOutput: true,
  },
}

/**
 * Get the configuration directory path
 */
export function getConfigDir(): string {
  return process.env.VULTISIG_CONFIG_DIR ?? join(homedir(), '.vultisig')
}

/**
 * Get the configuration file path
 */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

/**
 * Ensure the config directory exists
 */
export function ensureConfigDir(): void {
  const configDir = getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
}

/**
 * Read the CLI configuration
 */
export function readConfig(): CLIConfig {
  try {
    const configPath = getConfigPath()
    if (!existsSync(configPath)) {
      return { ...DEFAULT_CONFIG }
    }
    const data = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(data)
    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      preferences: {
        ...DEFAULT_CONFIG.preferences,
        ...parsed.preferences,
      },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * Write the CLI configuration
 */
export function writeConfig(config: CLIConfig): void {
  ensureConfigDir()
  const configPath = getConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

/**
 * Update specific config values
 */
export function updateConfig(updates: Partial<CLIConfig>): CLIConfig {
  const current = readConfig()
  const updated = {
    ...current,
    ...updates,
    preferences: {
      ...current.preferences,
      ...(updates.preferences ?? {}),
    },
  }
  writeConfig(updated)
  return updated
}

/**
 * Check if this is the first run
 */
export function isFirstRun(): boolean {
  const config = readConfig()
  return !config.initialized
}

/**
 * Mark as initialized
 */
export function markInitialized(): void {
  updateConfig({
    initialized: true,
    initializedAt: new Date().toISOString(),
  })
}

/**
 * Get a preference value
 */
export function getPreference<K extends keyof CLIConfig['preferences']>(key: K): CLIConfig['preferences'][K] {
  const config = readConfig()
  return config.preferences[key]
}

/**
 * Set a preference value
 */
export function setPreference<K extends keyof CLIConfig['preferences']>(
  key: K,
  value: CLIConfig['preferences'][K]
): void {
  const config = readConfig()
  config.preferences[key] = value
  writeConfig(config)
}

/**
 * Environment variable helpers
 */
export const EnvVars = {
  /**
   * Check if debug mode is enabled
   */
  isDebug(): boolean {
    return process.env.VULTISIG_DEBUG === '1'
  },

  /**
   * Check if silent mode is enabled via environment
   */
  isSilent(): boolean {
    return process.env.VULTISIG_SILENT === '1'
  },

  /**
   * Check if color output is disabled
   */
  isNoColor(): boolean {
    return process.env.VULTISIG_NO_COLOR === '1' || process.env.NO_COLOR === '1'
  },

  /**
   * Check if update checking is disabled
   */
  isNoUpdateCheck(): boolean {
    return process.env.VULTISIG_NO_UPDATE_CHECK === '1'
  },

  /**
   * Get custom config directory
   */
  getConfigDir(): string | undefined {
    return process.env.VULTISIG_CONFIG_DIR
  },
}

/**
 * Get effective config value (env vars override config file)
 */
export function getEffectiveConfig(): CLIConfig {
  const config = readConfig()

  // Apply environment variable overrides
  if (EnvVars.isNoColor()) {
    config.preferences.colorOutput = false
  }
  if (EnvVars.isNoUpdateCheck()) {
    config.preferences.autoUpdate = false
  }

  return config
}
