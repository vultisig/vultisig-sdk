import * as path from 'path'
import * as fs from 'fs'
import { config } from 'dotenv'

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '../../.env')
config({ path: envPath })

export type VaultConfig = {
  vaultPath?: string
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
      vaultPath: resolveVaultPath(providedVault),
      vaultPassword: providedPassword
    }
  }
  
  // If only vault is provided, use it with env password if available
  if (providedVault) {
    return {
      vaultPath: resolveVaultPath(providedVault),
      vaultPassword: providedPassword || process.env.VAULT_PASSWORD
    }
  }
  
  // If only password is provided, use env vault if available
  if (providedPassword !== undefined) {
    const envVaultPath = process.env.VAULT_PATH
    return {
      vaultPath: envVaultPath ? resolveVaultPath(envVaultPath) : undefined,
      vaultPassword: providedPassword
    }
  }
  
  // Neither provided - check if .env file exists and has vault config
  if (fs.existsSync(envPath) && process.env.VAULT_PATH) {
    return {
      vaultPath: resolveVaultPath(process.env.VAULT_PATH),
      vaultPassword: process.env.VAULT_PASSWORD
    }
  }
  
  // Nothing configured - return empty to trigger auto-discovery
  return {}
}

/**
 * Resolve vault path to absolute path
 */
function resolveVaultPath(vaultPath: string): string {
  // If it's already an absolute path, return it
  if (path.isAbsolute(vaultPath)) {
    return vaultPath
  }
  
  // Otherwise, resolve relative to CLI directory
  return path.resolve(__dirname, '../..', vaultPath)
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
