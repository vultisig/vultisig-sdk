import { config } from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

import { getVaultsDir } from './paths'

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '../../.env')
config({ path: envPath })

export type VaultConfig = {
  vaultName?: string
  vaultPassword?: string
}

/**
 * Get vault configuration with automatic fallback logic:
 * 1. Use provided vault/password if given
 * 2. Try to load from .env file if it exists
 * 3. Return undefined to trigger auto-discovery
 */
export function getVaultConfig(providedVault?: string, providedPassword?: string): VaultConfig {
  // If both are provided, use them
  if (providedVault && providedPassword !== undefined) {
    return {
      vaultName: resolveVaultName(providedVault),
      vaultPassword: providedPassword,
    }
  }

  // If only vault is provided, use it with env password if available
  if (providedVault) {
    return {
      vaultName: resolveVaultName(providedVault),
      vaultPassword: providedPassword || process.env.VAULT_PASSWORD,
    }
  }

  // If only password is provided, use env vault if available
  if (providedPassword !== undefined) {
    const envVaultName = process.env.VAULT_NAME
    return {
      vaultName: envVaultName ? resolveVaultName(envVaultName) : undefined,
      vaultPassword: providedPassword,
    }
  }

  // Neither provided - check if .env file exists and has vault config
  if (fs.existsSync(envPath) && process.env.VAULT_NAME) {
    return {
      vaultName: resolveVaultName(process.env.VAULT_NAME),
      vaultPassword: process.env.VAULT_PASSWORD,
    }
  }

  // Nothing configured - return empty to trigger auto-discovery
  return {}
}

/**
 * Resolve vault path to absolute path with intelligent search:
 * 1. Check if it's an absolute path that exists
 * 2. Check if it's a relative path that exists
 * 3. Search in vaults directory by name (with or without .vult extension)
 * 4. Match vault files that start with the given name
 */
function resolveVaultName(vaultName: string): string {
  // If it's already an absolute path and exists, return it
  if (path.isAbsolute(vaultName) && fs.existsSync(vaultName)) {
    return vaultName
  }

  // Check if it's a relative path that exists
  const relativePath = path.resolve(process.cwd(), vaultName)
  if (fs.existsSync(relativePath)) {
    return relativePath
  }

  // Search in vaults directory
  const vaultsDir = getVaultsDir()

  // Try exact match with .vult extension
  if (!vaultName.endsWith('.vult')) {
    const withExtension = path.join(vaultsDir, `${vaultName}.vult`)
    if (fs.existsSync(withExtension)) {
      return withExtension
    }
  } else {
    const exactPath = path.join(vaultsDir, vaultName)
    if (fs.existsSync(exactPath)) {
      return exactPath
    }
  }

  // Try finding files that start with the vault name
  try {
    const files = fs.readdirSync(vaultsDir)
    const baseName = vaultName.replace(/\.vult$/i, '')

    // Find files that start with the base name
    const matches = files.filter(
      file => file.toLowerCase().startsWith(baseName.toLowerCase()) && file.toLowerCase().endsWith('.vult')
    )

    if (matches.length > 0) {
      // If multiple matches, prefer exact match
      const exactMatch = matches.find(file => file.toLowerCase() === `${baseName.toLowerCase()}.vult`)
      const selectedFile = exactMatch || matches[0]
      return path.join(vaultsDir, selectedFile)
    }
  } catch {
    // Vaults directory doesn't exist or can't be read
  }

  // If nothing found, return the original path resolved relative to CLI directory
  // This will fail later with a clear error message
  return path.resolve(__dirname, '../..', vaultName)
}

/**
 * Get default network from environment
 */
export function getDefaultNetwork(): string | undefined {
  return process.env.DEFAULT_NETWORK
}

/**
 * Get default signing mode from environment
 */
export function getDefaultSigningMode(): string {
  return process.env.DEFAULT_SIGNING_MODE || 'fast'
}
