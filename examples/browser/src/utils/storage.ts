/**
 * Vault list item for localStorage persistence
 */
export type VaultListItem = {
  id: string
  name: string
  type: 'fast' | 'secure'
  createdAt: number
}

const VAULT_LIST_KEY = 'vultisig_vault_list'
const SETTINGS_KEY = 'vultisig_settings'

/**
 * Load vault list from localStorage
 */
export function loadVaultList(): VaultListItem[] {
  try {
    const data = localStorage.getItem(VAULT_LIST_KEY)
    return data ? JSON.parse(data) : []
  } catch (error) {
    console.error('Failed to load vault list:', error)
    return []
  }
}

/**
 * Save vault list to localStorage
 */
export function saveVaultList(vaults: VaultListItem[]): void {
  try {
    localStorage.setItem(VAULT_LIST_KEY, JSON.stringify(vaults))
  } catch (error) {
    console.error('Failed to save vault list:', error)
  }
}

/**
 * Add vault to list
 */
export function addVaultToList(vault: VaultListItem): void {
  const vaults = loadVaultList()
  const existing = vaults.find(v => v.id === vault.id)

  if (!existing) {
    vaults.push(vault)
    saveVaultList(vaults)
  }
}

/**
 * Remove vault from list
 */
export function removeVaultFromList(vaultId: string): void {
  const vaults = loadVaultList()
  const filtered = vaults.filter(v => v.id !== vaultId)
  saveVaultList(filtered)
}

/**
 * Update vault in list
 */
export function updateVaultInList(vaultId: string, updates: Partial<VaultListItem>): void {
  const vaults = loadVaultList()
  const index = vaults.findIndex(v => v.id === vaultId)

  if (index !== -1) {
    vaults[index] = { ...vaults[index], ...updates }
    saveVaultList(vaults)
  }
}

/**
 * App settings interface
 */
export type AppSettings = {
  theme: 'light' | 'dark'
  defaultCurrency: string
  autoLockTimeout: number
  showTestnets: boolean
}

const defaultSettings: AppSettings = {
  theme: 'light',
  defaultCurrency: 'USD',
  autoLockTimeout: 300000, // 5 minutes
  showTestnets: false,
}

/**
 * Load app settings
 */
export function loadSettings(): AppSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY)
    return data ? { ...defaultSettings, ...JSON.parse(data) } : defaultSettings
  } catch (error) {
    console.error('Failed to load settings:', error)
    return defaultSettings
  }
}

/**
 * Save app settings
 */
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save settings:', error)
  }
}
